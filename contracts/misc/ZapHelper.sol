// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IConcentratedLiquidityPool.sol";
import "../libraries/TickMath.sol";
import "../libraries/FullMath.sol";
import "../libraries/DyDxMath.sol";

/// @notice Calculate the Price Impact Size
contract ZapHelper {
    struct ZapCache {
        uint256 currentPrice;
        uint256 currentLiquidity;
        uint256 input;
        uint256 output;
        int24 nextTickToCross;
    }

    // @notice Calculate the amount of token
    // case1) pool.price() > targetPrice (price is decreasing)
    //        > trading from token0 to token1
    //
    //        zeroForOne = true,
    //        amount0 = input  token0 amount for trading from pool.price() to target price
    //        amount1 = output token1 amount for trading from pool.price() to target price
    //
    // case2) pool.price() < targetPrice (price is increasing)
    //        > trading from token1 to token0
    //
    //        zeroForOne = false
    //        amount0 = output token0 amount for trading from pool.price() to target price
    //        amount1 = input  token1 amount for trading from pool.price() to target price
    function expectAmount(address pool, uint160 targetPrice)
    external
    view
    returns (
        bool zeroForOne,
        uint256 amount0,
        uint256 amount1
    )
    {
        ZapCache memory cache;
        {
            (uint160 poolPrice, int24 nearestTick) = IConcentratedLiquidityPool(pool).getPriceAndNearestTicks();
            zeroForOne = poolPrice > targetPrice;
            cache = ZapCache(
                poolPrice,
                IConcentratedLiquidityPool(pool).liquidity(),
                0,
                0,
                zeroForOne ? nearestTick : IConcentratedLiquidityPool(pool).ticks(nearestTick).nextTick
            );
        }

        if (zeroLiquidity(cache)) return (zeroForOne, 0, 0);

        uint24 swapFee = IConcentratedLiquidityPool(pool).swapFee();
        int24 iTickSpacing = int24(IConcentratedLiquidityPool(pool).tickSpacing());

        amount0 = 0;
        amount1 = 0;
        while (true) {
            uint256 nextTickPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
            bool cross = false;
            if (zeroForOne) {
                // Trading token 0 (x) for token 1 (y).
                // Price is decreasing.
                uint256 newPrice = nextTickPrice <= targetPrice ? targetPrice : nextTickPrice;

                amount0 += DyDxMath.getDx(cache.currentLiquidity, newPrice, cache.currentPrice, true);
                amount1 += amountWithOutFee(DyDxMath.getDy(cache.currentLiquidity, newPrice, cache.currentPrice, false), swapFee);
                cache.currentPrice = newPrice;

                if (nextTickPrice > targetPrice) cross = true;
            } else {
                // Trading token 1 (y) for token 1 (x).
                // Price is increasing.
                uint256 newPrice = nextTickPrice >= targetPrice ? targetPrice : nextTickPrice;

                amount1 += DyDxMath.getDy(cache.currentLiquidity, cache.currentPrice, newPrice, false);
                amount0 += amountWithOutFee(DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, newPrice, false), swapFee);
                cache.currentPrice = newPrice;

                if (nextTickPrice < targetPrice) cross = true;
            }

            if (cross) {
                (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);

                if (cache.currentLiquidity == 0) {
                    if (cache.nextTickToCross == TickMath.MAX_TICK || cache.nextTickToCross == TickMath.MIN_TICK) {
                        break;
                    }
                    cache.currentPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
                    (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);
                }
            } else {
                break;
            }
        }
    }

    function crossTick(
        address pool,
        ZapCache memory cache,
        int24 tickSpacing,
        bool zeroForOne
    ) private view returns (uint256 currentLiquidity, int24 nextTickToCross) {
        if (zeroForOne) {
            // Moving backwards through the linked list.
            // Liquidity cannot overflow due to the MAX_TICK_LIQUIDITY requirement.
        unchecked {
            if ((cache.nextTickToCross / tickSpacing) % 2 == 0) {
                currentLiquidity = cache.currentLiquidity - IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).liquidity;
            } else {
                currentLiquidity = cache.currentLiquidity + IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).liquidity;
            }
        }
            nextTickToCross = IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).previousTick;
        } else {
            // Moving forwards through the linked list.
        unchecked {
            if ((cache.nextTickToCross / tickSpacing) % 2 == 0) {
                currentLiquidity = cache.currentLiquidity + IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).liquidity;
            } else {
                currentLiquidity = cache.currentLiquidity - IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).liquidity;
            }
        }
            nextTickToCross = IConcentratedLiquidityPool(pool).ticks(cache.nextTickToCross).nextTick;
        }
    }

    function zeroLiquidity(ZapCache memory cache) internal pure returns (bool) {
        if (cache.currentLiquidity > 0) {
            return false;
        }
        return cache.nextTickToCross == TickMath.MIN_TICK || cache.nextTickToCross == TickMath.MAX_TICK;
    }

    function amountWithOutFee(uint256 amount, uint256 swapFee) private pure returns (uint256) {
        return amount - FullMath.mulDivRoundingUp(amount, swapFee, 1e6);
    }
}
