// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import "../../libraries/DyDxMath.sol";

contract DyDxMathMock {
    function getLiquidityForAmounts(
        uint256 priceLower,
        uint256 priceUpper,
        uint256 currentPrice,
        uint256 dy,
        uint256 dx
    ) external pure returns (uint256 liquidity) {
        return DyDxMath.getLiquidityForAmounts(priceLower, priceUpper, currentPrice, dy, dx);
    }

    function getAmountsForLiquidity(
        uint256 priceLower,
        uint256 priceUpper,
        uint256 currentPrice,
        uint256 liquidityAmount,
        bool roundUp
    ) external pure returns (uint128 token0amount, uint128 token1amount) {
        return DyDxMath.getAmountsForLiquidity(priceLower, priceUpper, currentPrice, liquidityAmount, roundUp);
    }
}
