// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IRewardLiquidityPoolManagerStruct {
    struct Position {
        address pool; /// @dev the pool address
        uint128 liquidity; /// @dev The amount of liquidity for this position
        int24 lower; /// @dev The lower end of the tick range for the position
        int24 upper; /// @dev The upper end of the tick range for the position
        uint32 latestAddition; /// @dev useless field, but reserved for the future
        uint256 feeGrowthInside0; /// @dev The fee growth of token0 as of the last action on the individual position
        uint256 feeGrowthInside1; /// @dev The fee growth of token0 as of the last action on the individual position
        uint256 rewardGrowthInside;
        uint256 feeOwed0; /// @dev The amount of token0 owed to the position as of the last computation
        uint256 feeOwed1; /// @dev The amount of token1 owed to the position as of the last computation
        uint256 rewardOwed;
    }

    struct MintParam {
        address pool;
        int24 lowerOld;
        int24 lower;
        int24 upperOld;
        int24 upper;
        uint128 amount0Desired;
        uint128 amount1Desired;
        uint256 minLiquidity;
        uint256 positionId;
    }

    struct MintNativeParam {
        address pool;
        int24 lowerOld;
        int24 lower;
        int24 upperOld;
        int24 upper;
        uint128 amountDesired;
        uint256 minLiquidity;
        uint256 positionId;
    }
}
