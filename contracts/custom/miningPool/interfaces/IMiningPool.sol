// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "./IMiningPoolStruct.sol";
import "../../../interfaces/IConcentratedLiquidityPool.sol";
import "../../common/interfaces/ICustomPool.sol";

/// @notice Mining Pool interface.
interface IMiningPool is ICustomPool, IMiningPoolStruct, IConcentratedLiquidityPoolStruct, IConcentratedLiquidityPool {

    /// @notice reward Token
    function rewardToken() external view returns (address);

    /// @notice The reward growth collected per unit of liquidity for the entire life of the pool
    function rewardGrowthGlobal() external view returns (uint256);

    /// @dev deposit Reward Token
    function depositReward(uint256 amount) external view returns (uint256);

    /// @notice reward growth inside the given price range
    /// @param lower The lower tick of the position
    /// @param upper The upper tick of the position
    function rangeRewardGrowth(int24 lower, int24 upper) external view returns (uint256 rewardGrowthInside);

    /// @notice Collects tokens owed to a position
    /// @param lower The lower tick of the position
    /// @param upper The upper tick of the position
    /// @param desiredReward How much amount want be withdrawn from the rewards owed
    // @dev If desired rewards exceeds the possible amount, only the possible amount will be returned.
    function collectReward(
        int24 lower,
        int24 upper,
        uint256 desiredReward
    ) external returns (uint256 rewardAmount);
}
