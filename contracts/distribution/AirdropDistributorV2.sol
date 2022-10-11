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
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IMasterDeployer.sol";
import "../interfaces/IConcentratedLiquidityPool.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/LPAirdropCallee.sol";
import "../libraries/SafeCast.sol";
import "../interfaces/IAirdropPool.sol";
import "../interfaces/IAirdropDistributorV2.sol";

// @notice Airdrop Token distribution Contract for Liquidity Provider
contract AirdropDistributorV2 is IAirdropDistributorV2, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    address internal wKLAY;
    IMasterDeployer public masterDeployer;

    address[] public airdropPool;
    mapping(address => bool) private isAirdropPool;

    mapping(address => mapping(address => uint128)) private depositAmount;
    mapping(address => uint256) private airdropStartTimePerPool;

    uint256 public constant PERIOD = 1 weeks;

    modifier NotPhased() {
        require(masterDeployer.airdropDistributor() == address(this), "AirdropDistributor is phased");
        _;
    }

    function initialize(address _masterDeployer, address _WKLAY) external initializer {
        masterDeployer = IMasterDeployer(_masterDeployer);
        wKLAY = _WKLAY;
        __Ownable_init();
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

    /// @notice list of tokens that can be airdropped to the given pool
    function airdropTokens(address pool) public view returns (address[] memory tokens) {
        address token0 = IConcentratedLiquidityPool(pool).token0();
        address token1 = IConcentratedLiquidityPool(pool).token1();
        if (_supportRewardToken(pool)) {
            tokens = new address[](3);
            tokens[0] = token0;
            tokens[1] = token1;
            tokens[2] = LPRewardCallee(pool).rewardToken();
        } else {
            tokens = new address[](2);
            tokens[0] = token0;
            tokens[1] = token1;
        }
    }

    /// @notice airdrop information deposited in the pool
    function depositedAirdrop(address pool)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory amounts,
            uint256 startTime
        )
    {
        tokens = airdropTokens(pool);
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            amounts[i] = depositAmount[pool][tokens[i]];
        }
        startTime = airdropStartTimePerPool[pool];
    }

    /// @notice deposit klay to the pool. this klay will be distributed to the next epoch
    /// @param pool the address of pangea pool to deposit
    /// @dev transaction will revert if the asset in the pool is not WKLAY
    function depositKlay(address pool) external payable NotPhased {
        address token = wKLAY;
        validateToDeposit(pool, token);

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
    ) external NotPhased {
        validateToDeposit(pool, token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        _deposit(pool, token, amount);
    }

    /// @notice airdrop the deposited assets of pool
    /// @param pool the address of pangea pool
    function airdrop(address pool) external NotPhased {
        if (airdropStartTimePerPool[pool] > epochStartTime()) revert NotYet();

        _distribute(pool);
    }

    /// @notice airdrop Batch Call
    /// @param pools list of the addresses of pangea pool
    function airdropList(address[] memory pools) external NotPhased {
        uint256 _epochStartTime = epochStartTime();
        for (uint256 i = 0; i < pools.length; i++) {
            address pool = pools[i];

            if (airdropStartTimePerPool[pool] > _epochStartTime) continue;
            if ((IAirdropPool(pool).airdropStartTime() + IAirdropPool(pool).airdropPeriod()) > _epochStartTime) continue;

            _distribute(pool);
        }
    }

    /// @notice airdrop the deposited assets all on this epoch
    function airdropAll() external NotPhased {
        uint256 _epochStartTime = epochStartTime();

        for (uint256 i = 0; i < airdropPool.length; i++) {
            address pool = airdropPool[i];
            if ((IAirdropPool(pool).airdropStartTime() + IAirdropPool(pool).airdropPeriod()) > _epochStartTime) {
                continue;
            }

            if (airdropStartTimePerPool[pool] <= _epochStartTime) {
                _distribute(pool);
            }
        }
    }

    function validateToDeposit(address pool, address token) internal {
        if (!masterDeployer.pools(pool)) revert NotExists();
        address[] memory tokens = airdropTokens(pool);

        for (uint256 i = 0; i < tokens.length; i++) {
            if (token == tokens[i]) return;
        }

        revert NotAllowedToken();
    }

    function _deposit(
        address pool,
        address token,
        uint128 amount
    ) internal {
        if (airdropStartTimePerPool[pool] > 0 && airdropStartTimePerPool[pool] <= epochStartTime()) {
            // edge case
            // If the previously deposited assets have not been distributed, distribute them first and deposit.
            _distribute(pool);
        }

        if (!isAirdropPool[pool]) {
            isAirdropPool[pool] = true;
            airdropPool.push(pool);
        }

        depositAmount[pool][token] += amount;
        airdropStartTimePerPool[pool] = nextEpochStartTime();

        emit Deposit(pool, token, amount, msg.sender);
    }

    function _supportRewardToken(address pool) internal view returns (bool ok) {
        try LPRewardCallee(pool).rewardToken() returns (address) {
            ok = true;
        } catch {
            ok = false;
        }
        return ok;
    }

    function _distribute(address pool) internal {
        if (_supportRewardToken(pool)) {
            _airdropWithRewardToken(pool);
        } else {
            _airdrop(pool);
        }
    }

    function _airdrop(address pool) internal {
        address token0 = IConcentratedLiquidityPool(pool).token0();
        address token1 = IConcentratedLiquidityPool(pool).token1();

        uint256 startTime = epochStartTime();
        uint256 period = PERIOD;

        uint128 airdrop0 = _loadAirdropAmount(pool, token0, startTime, period);
        uint128 airdrop1 = _loadAirdropAmount(pool, token1, startTime, period);

        airdropStartTimePerPool[pool] = 0;

        LPAirdropCallee(pool).depositAirdrop(airdrop0, airdrop1, startTime, period);
    }

    function _airdropWithRewardToken(address pool) internal {
        address token0 = IConcentratedLiquidityPool(pool).token0();
        address token1 = IConcentratedLiquidityPool(pool).token1();
        address rewardToken = LPRewardCallee(pool).rewardToken();

        uint256 startTime = epochStartTime();
        uint256 period = PERIOD;

        uint128 airdrop0 = _loadAirdropAmount(pool, token0, startTime, period);
        uint128 airdrop1 = _loadAirdropAmount(pool, token1, startTime, period);
        uint128 reward = _loadAirdropAmount(pool, rewardToken, startTime, period);

        airdropStartTimePerPool[pool] = 0;

        LPRewardCallee(pool).depositAirdropAndReward(airdrop0, airdrop1, reward, startTime, period);
    }

    function _loadAirdropAmount(
        address pool,
        address token,
        uint256 startTime,
        uint256 period
    ) internal returns (uint128 amount) {
        amount = depositAmount[pool][token];
        if (amount == 0) return amount;

        depositAmount[pool][token] = 0;
        IERC20(token).approve(pool, amount);
        emit Airdrop(pool, token, amount, startTime, period);
    }
}
