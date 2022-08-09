### Custom Pools for Pangeaswap

Custom pools are pools with extension features added to the functionality of the Pangea pool.



1. [rewardPool](/rewardPool)

Rewards are often given when the protocol try to increase the liquidity volume of the target pool. The Pangeaswap pool supports airdrops, 
but there is a limitation that airdrops are only possible with the tokens that make up the pool.

RewardPool is a custom pool that allows tokens other than airdrop tokens to be used as rewards. 

````solidity
/// @notice Reward Liquidity Pool interface.
interface IRewardLiquidityPool is IRewardLiquidityPoolStruct, IConcentratedLiquidityPoolStruct, IConcentratedLiquidityPool  {

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
````
