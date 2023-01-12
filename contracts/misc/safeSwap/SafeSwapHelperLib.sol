// SPDX-License-Identifier: GPL-2.0-or-later

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import {IConcentratedLiquidityPool as CLPool} from "../../interfaces/IConcentratedLiquidityPool.sol";
import "../../libraries/DyDxMath.sol";
import "../../libraries/TickMath.sol";
import "../../libraries/FullMath.sol";
import "hardhat/console.sol";

library SafeSwapHelperLib {
    struct SwapCache {
        uint256 currentPrice;
        uint256 currentLiquidity;
        uint256 input;
        uint256 output;
        int24 nextTickToCross;
    }

    function exactInput(
        address pool,
        address tokenIn,
        uint256 exactAmountIn
    )
        internal
        view
        returns (
            uint256 amountOut,
            uint256 price,
            bool overInput
        )
    {
        bool zeroForOne = determineZeroForOne(pool, tokenIn);
        uint24 swapFee = CLPool(pool).swapFee();
        int24 iTickSpacing = int24(CLPool(pool).tickSpacing());

        // initialize cache
        SwapCache memory cache;
        {
            (uint160 currentPrice, int24 nearestTick) = CLPool(pool).getPriceAndNearestTicks();
            cache = SwapCache({
                currentPrice: currentPrice,
                currentLiquidity: uint256(CLPool(pool).liquidity()),
                input: exactAmountIn,
                output: 0,
                nextTickToCross: zeroForOne ? nearestTick : CLPool(pool).ticks(nearestTick).nextTick
            });
        }
        if (zeroLiquidity(cache)) return (0, cache.currentPrice, exactAmountIn > 0);

        while (cache.input != 0) {
            uint256 nextTickPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
            uint256 output = 0;
            bool cross = false;

            if (zeroForOne) {
                // Trading token 0 (x) for token 1 (y).
                // Price is decreasing.
                // Maximum input amount within current tick range: Δx = Δ(1/√𝑃) · L.
                uint256 maxDx = DyDxMath.getDx(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false);

                if (cache.input <= maxDx) {
                    // We can swap within the current range.
                    uint256 liquidityPadded = cache.currentLiquidity << FixedPoint.Q96RES;
                    // Calculate new price after swap: √𝑃[new] =  L · √𝑃 / (L + Δx · √𝑃)
                    // This is derived from Δ(1/√𝑃) = Δx/L
                    // where Δ(1/√𝑃) is 1/√𝑃[old] - 1/√𝑃[new] and we solve for √𝑃[new].
                    // In case of an overflow we can use: √𝑃[new] = L / (L / √𝑃 + Δx).
                    // This is derived by dividing the original fraction by √𝑃 on both sides.
                    uint256 newPrice = uint256(
                        FullMath.mulDivRoundingUp(liquidityPadded, cache.currentPrice, liquidityPadded + cache.currentPrice * cache.input)
                    );

                    if (!(nextTickPrice <= newPrice && newPrice < cache.currentPrice)) {
                        // Overflow. We use a modified version of the formula.
                        newPrice = uint160(UnsafeMath.divRoundingUp(liquidityPadded, liquidityPadded / cache.currentPrice + cache.input));
                    }
                    // Based on the price difference calculate the output of th swap: Δy = Δ√P · L.
                    output = DyDxMath.getDy(cache.currentLiquidity, newPrice, cache.currentPrice, false);
                    if (output == DyDxMath.getDy(cache.currentLiquidity, TickMath.MIN_SQRT_RATIO, cache.currentPrice, false)) {
                        overInput = true;
                    }
                    cache.currentPrice = newPrice;
                    cache.input = 0;
                } else {
                    // Execute swap step and cross the tick.
                    output = DyDxMath.getDy(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false);
                    cache.currentPrice = nextTickPrice;
                    cross = true;
                    cache.input -= maxDx;
                }
            } else {
                // Price is increasing.
                // Maximum swap amount within the current tick range: Δy = Δ√P · L.
                uint256 maxDy = DyDxMath.getDy(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false);

                if (cache.input <= maxDy) {
                    // We can swap within the current range.
                    // Calculate new price after swap: ΔP = Δy/L.
                    uint256 newPrice = cache.currentPrice + FullMath.mulDiv(cache.input, FixedPoint.Q96, cache.currentLiquidity);
                    // Calculate output of swap
                    // - Δx = Δ(1/√P) · L.
                    output = DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, newPrice, false);
                    if (output == DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, TickMath.MAX_SQRT_RATIO - 1, false)) {
                        overInput = true;
                    }
                    cache.currentPrice = newPrice;
                    cache.input = 0;
                } else {
                    // Swap & cross the tick.
                    output = DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false);
                    cache.currentPrice = nextTickPrice;
                    cross = true;
                    cache.input -= maxDy;
                }
            }

            amountOut += amountWithOutFee(output, swapFee);

            if (cross) {
                (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);

                if (cache.currentLiquidity == 0) {
                    if (cache.nextTickToCross == TickMath.MAX_TICK || cache.nextTickToCross == TickMath.MIN_TICK) {
                        // In the case of the last tick, there is no next tick.
                        // price must be crossed because of rangeFeeGrowth
                        if (zeroForOne) {
                            cache.currentPrice = Math.max(cache.currentPrice - 1, TickMath.MIN_SQRT_RATIO);
                        } else {
                            cache.currentPrice = Math.min(cache.currentPrice + 1, TickMath.MAX_SQRT_RATIO - 1);
                        }
                        break;
                    }
                    cache.currentPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
                    (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);
                }
            }
        }
        if (cache.input > 0) {
            overInput = true;
        }
        price = cache.currentPrice;
    }

    function exactOutput(
        address pool,
        address tokenIn,
        uint256 exactAmountOut
    ) internal view returns (uint256 amountIn, uint256 price) {
        bool zeroForOne = determineZeroForOne(pool, tokenIn);
        uint24 swapFee = CLPool(pool).swapFee();
        int24 iTickSpacing = int24(CLPool(pool).tickSpacing());

        // initialize cache
        SwapCache memory cache;
        {
            (uint160 currentPrice, int24 nearestTick) = CLPool(pool).getPriceAndNearestTicks();
            cache = SwapCache({
                currentPrice: currentPrice,
                currentLiquidity: uint256(CLPool(pool).liquidity()),
                input: 0,
                output: exactAmountOut,
                nextTickToCross: zeroForOne ? nearestTick : CLPool(pool).ticks(nearestTick).nextTick
            });
        }
        if (zeroLiquidity(cache)) return (0, cache.currentPrice);

        while (cache.output != 0) {
            uint256 nextTickPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
            uint256 input = 0;
            bool cross = false;

            if (zeroForOne) {
                uint256 maxDy = amountWithOutFee(DyDxMath.getDy(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false), swapFee);

                if (cache.output <= maxDy) {
                    uint256 newPrice = cache.currentPrice -
                        FullMath.mulDivRoundingUp(amountWithFee(cache.output, swapFee), FixedPoint.Q96, cache.currentLiquidity);
                    input = DyDxMath.getDx(cache.currentLiquidity, newPrice, cache.currentPrice, true);

                    cache.currentPrice = newPrice;
                    cache.output = 0;
                } else {
                    input = DyDxMath.getDx(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false);

                    cache.currentPrice = nextTickPrice;
                    cache.output -= maxDy;
                    cross = true;
                }
            } else {
                uint256 maxDx = amountWithOutFee(DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false), swapFee);

                if (cache.output <= maxDx) {
                    uint256 liquidityPadded = cache.currentLiquidity << FixedPoint.Q96RES;
                    uint256 newPrice = uint256(
                        FullMath.mulDivRoundingUp(
                            liquidityPadded,
                            cache.currentPrice,
                            liquidityPadded - cache.currentPrice * amountWithFee(cache.output, swapFee)
                        )
                    );

                    if (!(cache.currentPrice <= newPrice && newPrice < nextTickPrice)) {
                        // Overflow. We use a modified version of the formula.
                        newPrice = uint160(
                            UnsafeMath.divRoundingUp(
                                liquidityPadded,
                                liquidityPadded / cache.currentPrice - amountWithFee(cache.output, swapFee)
                            )
                        );
                    }

                    input = DyDxMath.getDy(cache.currentLiquidity, cache.currentPrice, newPrice, true);

                    cache.currentPrice = newPrice;
                    cache.output = 0;
                } else {
                    input = DyDxMath.getDy(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false);

                    cache.currentPrice = nextTickPrice;
                    cache.output -= maxDx;
                    cross = true;
                }
            }
            amountIn += input;

            if (cross) {
                (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);

                if (cache.currentLiquidity == 0) {
                    if (cache.nextTickToCross == TickMath.MAX_TICK || cache.nextTickToCross == TickMath.MIN_TICK) {
                        // In the case of the last tick, there is no next tick.
                        // price must be crossed because of rangeFeeGrowth
                        if (zeroForOne) {
                            cache.currentPrice = Math.max(cache.currentPrice - 1, TickMath.MIN_SQRT_RATIO);
                        } else {
                            cache.currentPrice = Math.min(cache.currentPrice + 1, TickMath.MAX_SQRT_RATIO - 1);
                        }
                        break;
                    }
                    cache.currentPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
                    (cache.currentLiquidity, cache.nextTickToCross) = crossTick(pool, cache, iTickSpacing, zeroForOne);
                }
            }
        }
        price = cache.currentPrice;
        require(cache.output == 0, "INSUFFICIENT OUTPUT");
    }

    function crossTick(
        address pool,
        SwapCache memory cache,
        int24 tickSpacing,
        bool zeroForOne
    ) private view returns (uint256 currentLiquidity, int24 nextTickToCross) {
        if (zeroForOne) {
            // Moving backwards through the linked list.
            // Liquidity cannot overflow due to the MAX_TICK_LIQUIDITY requirement.
            unchecked {
                if ((cache.nextTickToCross / tickSpacing) % 2 == 0) {
                    currentLiquidity = cache.currentLiquidity - CLPool(pool).ticks(cache.nextTickToCross).liquidity;
                } else {
                    currentLiquidity = cache.currentLiquidity + CLPool(pool).ticks(cache.nextTickToCross).liquidity;
                }
            }
            nextTickToCross = CLPool(pool).ticks(cache.nextTickToCross).previousTick;
        } else {
            // Moving forwards through the linked list.
            unchecked {
                if ((cache.nextTickToCross / tickSpacing) % 2 == 0) {
                    currentLiquidity = cache.currentLiquidity + CLPool(pool).ticks(cache.nextTickToCross).liquidity;
                } else {
                    currentLiquidity = cache.currentLiquidity - CLPool(pool).ticks(cache.nextTickToCross).liquidity;
                }
            }
            nextTickToCross = CLPool(pool).ticks(cache.nextTickToCross).nextTick;
        }
    }

    function zeroLiquidity(SwapCache memory cache) internal pure returns (bool) {
        if (cache.currentLiquidity > 0) {
            return false;
        }
        return cache.nextTickToCross == TickMath.MIN_TICK || cache.nextTickToCross == TickMath.MAX_TICK;
    }

    function amountWithFee(uint256 amount, uint256 swapFee) private pure returns (uint256) {
        return FullMath.mulDivRoundingUp(amount, 1e6, 1e6 - swapFee);
    }

    function amountWithOutFee(uint256 amount, uint256 swapFee) private pure returns (uint256) {
        return amount - FullMath.mulDivRoundingUp(amount, swapFee, 1e6);
    }

    function determineZeroForOne(address pool, address tokenIn) private view returns (bool) {
        return CLPool(pool).token0() == tokenIn;
    }
}
