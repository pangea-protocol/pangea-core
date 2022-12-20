// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IAirdropDistributorV2.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// @notice Scheduler for distributing STONE to mining pools
contract StoneScheduler is OwnableUpgradeable {
    uint256 public constant WEEK = 604800;
    using SafeERC20 for IERC20;
    IAirdropDistributorV2 public airdropDistributor;
    IERC20 public stone;

    address[] public targetPools;
    mapping(address => bool) public isTargetPool;

    // epoch start time => pool address => allocated amount
    mapping(uint256 => mapping(address => uint128)) public scheduledAmounts;

    function initialize(
        address _airdropDistributor,
        address _stone,
        address[] memory _targetPools
    ) external initializer {
        airdropDistributor = IAirdropDistributorV2(_airdropDistributor);
        stone = IERC20(_stone);

        for (uint256 i = 0; i < _targetPools.length; i++) {
            address target = _targetPools[i];
            require(!isTargetPool[target], "DUPLICATED POOL");
            targetPools.push(target);
            isTargetPool[target] = true;
        }

        stone.approve(_airdropDistributor, type(uint256).max);

        __Ownable_init();
    }

    function totalTargetPool() external view returns (uint256) {
        return targetPools.length;
    }

    function addTargetPool(address _targetPool) external onlyOwner {
        require(!isTargetPool[_targetPool], "ALREADY EXISTS");
        isTargetPool[_targetPool] = true;

        targetPools.push(_targetPool);
    }

    function removeTargetPool(address _targetPool) external onlyOwner {
        require(isTargetPool[_targetPool], "NOT EXISTS");
        isTargetPool[_targetPool] = false;

        for (uint256 i = 0; i < targetPools.length - 1; i++) {
            if (targetPools[i] == _targetPool) {
                address temp = targetPools[targetPools.length - 1];
                targetPools[targetPools.length - 1] = _targetPool;
                targetPools[i] = temp;
            }
        }
        targetPools.pop();
    }

    function allocate(
        address pool,
        uint256 epochStartTime,
        uint128 amount
    ) external onlyOwner {
        require(isTargetPool[pool], "NOT TARGET POOL");
        require(epochStartTime % WEEK == 0, "INVALID EPOCH START TIME");
        require(epochStartTime > currentEpochStartTime(), "PAST EPOCH");
        scheduledAmounts[epochStartTime][pool] = amount;
    }

    function depositEpoch() external {
        uint256 nextEpochStartTime = currentEpochStartTime() + WEEK;

        for (uint256 i = 0; i < targetPools.length; i++) {
            address pool = targetPools[i];
            uint128 amount = scheduledAmounts[nextEpochStartTime][pool];
            if (amount > 0) {
                scheduledAmounts[nextEpochStartTime][pool] = 0;
                airdropDistributor.depositToken(pool, address(stone), amount);
            }
        }
    }

    function currentEpochStartTime() public view returns (uint256) {
        return (block.timestamp / WEEK) * WEEK;
    }
}
