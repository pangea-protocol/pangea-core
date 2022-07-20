// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../interfaces/IConcentratedLiquidityPool.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/TickMath.sol";
import "../libraries/FullMath.sol";
import "../libraries/SwapHelperLib.sol";

contract SwapHelper {
    address public wETH;

    constructor(address _wETH) {
        wETH = _wETH;
    }

    function calculateExactInput(
        address[] calldata path,
        address tokenIn,
        uint256 exactAmountIn
    ) external view returns (uint256 amountOut, uint256 price) {
        tokenIn = tokenIn == address(0) ? wETH : tokenIn;

        amountOut = exactAmountIn;
        for (uint256 i = 0; i < path.length; i++) {
            address pool = path[i];

            (amountOut, price) = SwapHelperLib.exactInput(pool, tokenIn, amountOut);

            tokenIn = IConcentratedLiquidityPool(pool).token0() == tokenIn
                ? IConcentratedLiquidityPool(pool).token1()
                : IConcentratedLiquidityPool(pool).token0();
        }
    }

    function calculateExactInputSingle(
        address pool,
        address tokenIn,
        uint256 exactAmountIn
    ) external view returns (uint256 amountOut, uint256 price) {
        return SwapHelperLib.exactInput(pool, tokenIn == address(0) ? wETH : tokenIn, exactAmountIn);
    }

    function calculateExactOutput(
        address[] calldata path,
        address tokenIn,
        uint256 exactAmountOut
    ) external view returns (uint256 amountIn, uint256 price) {
        address tokenOut = findTokenOut(path, tokenIn);

        uint256 amountOut = exactAmountOut;
        for (uint256 i = path.length; i > 0; i--) {
            address pool = path[i - 1];

            tokenOut = IConcentratedLiquidityPool(pool).token0() == tokenOut
                ? IConcentratedLiquidityPool(pool).token1()
                : IConcentratedLiquidityPool(pool).token0();

            (amountOut, price) = SwapHelperLib.exactOutput(pool, tokenOut, amountOut);
        }
        amountIn = amountOut;
    }

    function findTokenOut(address[] calldata path, address tokenIn) internal view returns (address tokenOut) {
        tokenOut = tokenIn == address(0) ? wETH : tokenIn;
        IConcentratedLiquidityPool pool;
        for (uint256 i = 0; i < path.length; i++) {
            pool = IConcentratedLiquidityPool(path[i]);
            tokenOut = pool.token0() == tokenOut ? pool.token1() : pool.token0();
        }
        return tokenOut;
    }

    function calculateExactOutputSingle(
        address pool,
        address tokenIn,
        uint256 exactAmountOut
    ) external view returns (uint256 amountIn, uint256 price) {
        return SwapHelperLib.exactOutput(pool, tokenIn == address(0) ? wETH : tokenIn, exactAmountOut);
    }
}
