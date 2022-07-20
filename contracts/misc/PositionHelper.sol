// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../interfaces/IConcentratedLiquidityPoolManager.sol";
import "../interfaces/IConcentratedLiquidityPool.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/TickMath.sol";

contract PositionHelper {
    IConcentratedLiquidityPoolManager public poolManager;

    constructor(address _poolManager) {
        poolManager = IConcentratedLiquidityPoolManager(_poolManager);
    }

    function getAmountsForLiquidity(uint256 positionId, uint256 liquidity)
        external
        view
        returns (uint128 token0amount, uint128 token1amount)
    {
        IConcentratedLiquidityPoolManager.Position memory position = poolManager.positions(positionId);

        uint256 priceLower = uint256(TickMath.getSqrtRatioAtTick(position.lower));
        uint256 priceUpper = uint256(TickMath.getSqrtRatioAtTick(position.upper));
        uint256 currentPrice = uint256(IConcentratedLiquidityPool(position.pool).price());

        (token0amount, token1amount) = DyDxMath.getAmountsForLiquidity(priceLower, priceUpper, currentPrice, liquidity, false);
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
}
