// SPDX-License-Identifier: GPL-3.0

/*
 *
 * #####    ##   #    #  ####  ######   ##      #####  #####   ####  #####  ####   ####   ####  #
 * #    #  #  #  ##   # #    # #       #  #     #    # #    # #    #   #   #    # #    # #    # #
 * #    # #    # # #  # #      #####  #    #    #    # #    # #    #   #   #    # #      #    # #
 * #####  ###### #  # # #  ### #      ######    #####  #####  #    #   #   #    # #      #    # #
 * #      #    # #   ## #    # #      #    #    #      #   #  #    #   #   #    # #    # #    # #
 * #      #    # #    #  ####  ###### #    #    #      #    #  ####    #    ####   ####   ####  ######
 *
 */

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IConcentratedLiquidityPool as CLPool} from "../interfaces/IConcentratedLiquidityPool.sol";
import "../interfaces/IMasterDeployer.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/LPAirdropCallee.sol";
import "../libraries/SafeCast.sol";
import "../interfaces/IAirdropDistributor.sol";

// @notice Airdrop Token distribution Contract for Liquidity Provider
contract AirdropDistributor is IAirdropDistributor, Initializable {
    using SafeERC20 for IERC20;

    address internal wKLAY;
    IMasterDeployer public masterDeployer;

    address[] public airdropPool;
    mapping(address => bool) private isAirdropPool;

    mapping(address => mapping(address => uint128)) private depositAmount;
    mapping(address => uint256) private airdropStartTimePerPool;

    mapping(address => AirdropInfo[]) private _airdropSnapshot;
    uint256 public constant PERIOD = 1 weeks;

    function initialize(address _masterDeployer, address _WKLAY) external initializer {
        masterDeployer = IMasterDeployer(_masterDeployer);
        wKLAY = _WKLAY;
    }

    function epochStartTime() public view returns (uint256) {
        return (block.timestamp / PERIOD) * PERIOD;
    }

    function nextEpochStartTime() public view returns (uint256) {
        return epochStartTime() + PERIOD;
    }

    /// @notice Number of pools that have ever been deposited
    function airdropPoolLength() external view returns (uint256) {
        return airdropPool.length;
    }

    function airdropSnapshot(address pool, uint256 idx) external view returns (AirdropInfo memory snapshot) {
        snapshot = _airdropSnapshot[pool][idx];
    }

    function airdropSnapshotLength(address pool) external view returns (uint256 length) {
        length = _airdropSnapshot[pool].length;
    }

    /// @notice airdrop information deposited in the pool. amount0 & amount1 will be zero after airdrop allocation
    function depositedAirdrop(address pool) external view returns (AirdropInfo memory) {
        return
            AirdropInfo(
                depositAmount[pool][CLPool(pool).token0()],
                depositAmount[pool][CLPool(pool).token1()],
                airdropStartTimePerPool[pool]
            );
    }

    /// @notice deposit klay to the pool. this klay will be distributed to the next epoch
    /// @param pool the address of pangea pool to deposit
    /// @dev transaction will revert if the asset in the pool is not WKLAY
    function depositKlay(address pool) external payable {
        address token = wKLAY;
        uint256 amount = msg.value;
        IWETH(token).deposit{value: amount}();

        _deposit(pool, token, SafeCast.toUint128(amount));
    }

    /// @notice deposit Token to the pool. this token will be distributed to the next epoch
    /// @param pool the address of pangea pool to deposit
    /// @param token token address to deposit. it must be one of the pools' tokens.
    /// @param amount amount of token to deposit
    /// @dev Approval (token.approve(airdropDistributor, amount)) must be performed before transaction
    function depositToken(
        address pool,
        address token,
        uint128 amount
    ) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        _deposit(pool, token, amount);
    }

    /// @notice airdrop the deposited assets of pool
    /// @param pool the address of pangea pool
    function airdrop(address pool) external {
        if (airdropStartTimePerPool[pool] > epochStartTime()) revert NotYet();

        _airdrop(pool);
    }

    /// @notice airdrop the deposited assets all on this epoch
    function airdropAll() external {
        uint256 _epochStartTime = epochStartTime();

        for (uint256 i = 0; i < airdropPool.length; i++) {
            address pool = airdropPool[i];
            if (airdropStartTimePerPool[pool] > 0 && airdropStartTimePerPool[pool] <= _epochStartTime) {
                _airdrop(pool);
            }
        }
    }

    function _deposit(
        address pool,
        address token,
        uint128 amount
    ) internal {
        if (!masterDeployer.pools(pool)) revert NotExists();
        if (CLPool(pool).token0() != token && CLPool(pool).token1() != token) revert NotPoolToken();

        if (airdropStartTimePerPool[pool] > 0 && airdropStartTimePerPool[pool] <= epochStartTime()) {
            // edge case
            // If the previously deposited assets have not been distributed, distribute them first and deposit.
            _airdrop(pool);
        }

        if (!isAirdropPool[pool]) {
            isAirdropPool[pool] = true;
            airdropPool.push(pool);
        }

        depositAmount[pool][token] += amount;
        airdropStartTimePerPool[pool] = nextEpochStartTime();

        emit Deposit(pool, token, amount, msg.sender);
    }

    function _airdrop(address pool) internal {
        address token0 = CLPool(pool).token0();
        address token1 = CLPool(pool).token1();

        uint128 airdrop0 = depositAmount[pool][token0];
        uint128 airdrop1 = depositAmount[pool][token1];
        depositAmount[pool][token0] = 0;
        depositAmount[pool][token1] = 0;
        airdropStartTimePerPool[pool] = 0; // reset

        IERC20(token0).approve(pool, airdrop0);
        IERC20(token1).approve(pool, airdrop1);

        uint256 startTime = epochStartTime();
        uint256 period = PERIOD;

        LPAirdropCallee(pool).depositAirdrop(airdrop0, airdrop1, startTime, period);

        IERC20(token0).approve(pool, 0);
        IERC20(token1).approve(pool, 0);

        _airdropSnapshot[pool].push(AirdropInfo(airdrop0, airdrop1, startTime));
        emit Airdrop(pool, token0, token1, airdrop0, airdrop1, startTime, period);
    }
}
