// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../interfaces/IConcentratedLiquidityPool.sol";
import "../libraries/TickMath.sol";
import "../libraries/Ticks.sol";

/// @notice Concentrated Liquidity Pool periphery contract to read state.
contract ConcentratedLiquidityPoolHelper {
    struct SimpleTick {
        int24 index;
        uint128 liquidity;
    }

    struct DetailTick {
        int24 index;
        uint128 liquidity;
        uint256 feeGrowthOutside0;
        uint256 feeGrowthOutside1;
        uint160 secondsGrowthOutside;
    }

    function getTickState(IConcentratedLiquidityPool pool) external view returns (SimpleTick[] memory) {
        SimpleTick[] memory ticks = new SimpleTick[](pool.totalTicks());

        IConcentratedLiquidityPool.Tick memory tick;
        uint24 i;
        int24 current = TickMath.MIN_TICK;

        while (current != TickMath.MAX_TICK) {
            tick = pool.ticks(current);
            ticks[i++] = SimpleTick({index: current, liquidity: tick.liquidity});
            current = tick.nextTick;
        }

        tick = pool.ticks(current);
        ticks[i] = SimpleTick({index: TickMath.MAX_TICK, liquidity: tick.liquidity});

        return ticks;
    }

    function getTickStateDetail(IConcentratedLiquidityPool pool) external view returns (DetailTick[] memory) {
        DetailTick[] memory ticks = new DetailTick[](pool.totalTicks());

        IConcentratedLiquidityPool.Tick memory tick;
        uint24 i;
        int24 current = TickMath.MIN_TICK;

        while (current != TickMath.MAX_TICK) {
            tick = pool.ticks(current);
            ticks[i++] = DetailTick({
                index: current,
                liquidity: tick.liquidity,
                feeGrowthOutside0: tick.feeGrowthOutside0,
                feeGrowthOutside1: tick.feeGrowthOutside1,
                secondsGrowthOutside: tick.secondsGrowthOutside
            });
            current = tick.nextTick;
        }

        tick = pool.ticks(current);
        ticks[i] = DetailTick({
            index: current,
            liquidity: tick.liquidity,
            feeGrowthOutside0: tick.feeGrowthOutside0,
            feeGrowthOutside1: tick.feeGrowthOutside1,
            secondsGrowthOutside: tick.secondsGrowthOutside
        });

        return ticks;
    }
}
