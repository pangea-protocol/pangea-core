// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../interfaces/IConcentratedLiquidityPool.sol";

library TickIndex {
    /// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128.
    int24 internal constant MIN_TICK = -887272;
    /// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128 - 1.
    int24 internal constant MAX_TICK = -MIN_TICK;

    function adjust(
        IConcentratedLiquidityPool pool,
        int24 lowerOld,
        int24 lower,
        int24 upperOld,
        int24 upper
    )
        external
        view
        returns (
            int24,
            int24,
            int24,
            int24
        )
    {
        (lower, upper) = _adjustLowerAndUpper(pool, lower, upper);
        bool needToInitLower = needToInitialize(pool, lower);

        if (!needToInitLower) {
            lowerOld = pool.ticks(lower).previousTick;
        } else if (atWrongPlace(pool, lower, lowerOld)) {
            lowerOld = findIndex(pool, lower, lowerOld);
        }

        if (atUpperNext(pool, lowerOld, upper)) {
            return (lowerOld, lower, lower, upper);
        }

        bool needToInitUpper = needToInitialize(pool, upper);

        if (!needToInitUpper) {
            upperOld = pool.ticks(upper).previousTick;
        } else if (atWrongPlace(pool, upper, upperOld)) {
            upperOld = findIndex(pool, upper, upperOld);
        }

        return (lowerOld, lower, upperOld, upper);
    }

    function _adjustLowerAndUpper(
        IConcentratedLiquidityPool pool,
        int24 lower,
        int24 upper
    ) private view returns (int24 adjustedLower, int24 adjustedUpper) {
        // read tick spacing
        int24 tickSpacing = int24(pool.tickSpacing());

        // lower & upper tick cap
        {
            (int24 maxLower, int24 maxUpper) = maximumLowerAndUpper(tickSpacing);
            lower = lower < maxLower ? maxLower : lower;
            upper = upper > maxUpper ? maxUpper : upper;
        }

        // lower tick should be even & upper tick should be odd
        int24 unitLower = lower / tickSpacing;
        adjustedLower = unitLower % 2 == 0 ? unitLower * tickSpacing : (unitLower - 1) * tickSpacing;
        int24 unitUpper = upper / tickSpacing;
        adjustedUpper = unitUpper % 2 == 0 ? (unitUpper + 1) * tickSpacing : unitUpper * tickSpacing;
    }

    function maximumLowerAndUpper(int24 tickSpacing) private pure returns (int24 minLower, int24 maxUpper) {
        int24 unitLower = (MIN_TICK / tickSpacing);
        minLower = unitLower % 2 == 0 ? (unitLower + 2) * tickSpacing : (unitLower + 1) * tickSpacing;
        int24 unitUpper = (MAX_TICK / tickSpacing);
        maxUpper = unitUpper % 2 == 0 ? (unitUpper - 1) * tickSpacing : (unitUpper - 2) * tickSpacing;
    }

    function needToInitialize(IConcentratedLiquidityPool pool, int24 index) private view returns (bool) {
        if (index == MIN_TICK || index == MAX_TICK) return false;
        return pool.ticks(index).liquidity == 0;
    }

    function atWrongPlace(
        IConcentratedLiquidityPool pool,
        int24 index,
        int24 indexOld
    ) private view returns (bool) {
        if (indexOld >= index) return true;
        IConcentratedLiquidityPoolStruct.Tick memory old = pool.ticks(indexOld);
        return old.liquidity == 0 || index >= old.nextTick;
    }

    function atUpperNext(
        IConcentratedLiquidityPool pool,
        int24 lowerOld,
        int24 upper
    ) private view returns (bool) {
        IConcentratedLiquidityPoolStruct.Tick memory old = pool.ticks(lowerOld);
        return upper <= old.nextTick;
    }

    function atWrongPlace(
        int24 tick0,
        int24 tick1,
        int24 tick2
    ) private pure returns (bool) {
        return tick0 > tick1 || tick1 > tick2;
    }

    function findIndex(
        IConcentratedLiquidityPool pool,
        int24 index,
        int24 indexOld
    ) private view returns (int24) {
        int24 targetIndex = findStartIndex(pool, index, indexOld);

        IConcentratedLiquidityPoolStruct.Tick memory targetTick = pool.ticks(targetIndex);

        while (atWrongPlace(targetIndex, index, targetTick.nextTick)) {
            targetIndex = index < targetIndex ? targetTick.previousTick : targetTick.nextTick;
            targetTick = pool.ticks(targetIndex);
        }

        return targetIndex;
    }

    function findStartIndex(
        IConcentratedLiquidityPool pool,
        int24 index,
        int24 indexOld
    ) private view returns (int24) {
        IConcentratedLiquidityPoolStruct.Tick memory old = pool.ticks(indexOld);

        if (old.liquidity != 0) {
            return indexOld;
        }

        int24 currTick = pool.nearestTick();
        if (index > currTick) {
            if (MAX_TICK - index < index - currTick) {
                return MAX_TICK;
            } else {
                return currTick;
            }
        } else {
            if (index - MIN_TICK < currTick - index) {
                return MIN_TICK;
            } else {
                return currTick;
            }
        }
    }
}
