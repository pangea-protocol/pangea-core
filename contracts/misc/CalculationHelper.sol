// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../interfaces/IConcentratedLiquidityPool.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/TickMath.sol";

contract CalculationHelper {

    function getAmountsForLiquidity(
        address pool,
        int24 lower,
        int24 upper,
        uint256 liquidityAmount
    ) external view returns (uint128 token0amount, uint128 token1amount) {
        return
        DyDxMath.getAmountsForLiquidity(
            uint256(TickMath.getSqrtRatioAtTick(lower)),
            uint256(TickMath.getSqrtRatioAtTick(upper)),
            IConcentratedLiquidityPool(pool).price(),
            liquidityAmount,
            true
        );
    }

    function getLiquidityForAmounts(
        address pool,
        int24 lower,
        int24 upper,
        uint256 amount0,
        uint256 amount1
    ) external view returns (uint256 liquidity) {
        return
            DyDxMath.getLiquidityForAmounts(
                uint256(TickMath.getSqrtRatioAtTick(lower)),
                uint256(TickMath.getSqrtRatioAtTick(upper)),
                IConcentratedLiquidityPool(pool).price(),
                amount1,
                amount0
            );
    }

    /// @notice Calculates sqrt(1.0001^tick) * 2^96.
    function getPriceAtTick(int24 tick) external view returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    /// @notice Calculates the greatest tick value such that getRatioAtTick(tick) <= ratio.
    /// @param price Sqrt of price aka. √(token1/token0), multiplied by 2 ^ 96.
    function getTickAtSqrtRatio(uint160 price) external view returns (int24) {
        return TickMath.getTickAtSqrtRatio(price);
    }
}
