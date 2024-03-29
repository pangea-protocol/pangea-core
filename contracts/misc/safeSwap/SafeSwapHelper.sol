// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../../interfaces/IConcentratedLiquidityPool.sol";
import "./SafeSwapHelperLib.sol";

contract SafeSwapHelper is Initializable {

    address public wETH;

    function initialize(address _wETH) external initializer {
        wETH = _wETH;
    }

    /// @notice Calculate the maximum output that can be received when swapped according to the given path.
    /// @return amountOut the maximum output
    /// @return price     price after swapping
    /// @return overInput Check if more input has been given to receive the corresponding amountOut
    /// @return maximumAmountIn Maximum input that the path can handle
    function calculateExactInput(
        address[] calldata path,
        address tokenIn,
        uint256 exactAmountIn
    )
        external
        view
        returns (
            uint256 amountOut,
            uint256 price,
            bool overInput,
            uint256 maximumAmountIn
        )
    {
        address originalTokenIn = tokenIn;
        tokenIn = tokenIn == address(0) ? wETH : tokenIn;

        amountOut = exactAmountIn;
        bool _overInput;
        for (uint256 i = 0; i < path.length; i++) {
            address pool = path[i];

            (amountOut, price, _overInput) = SafeSwapHelperLib.exactInput(pool, tokenIn, amountOut);

            if (_overInput) {
                overInput = true;
            }

            tokenIn = IConcentratedLiquidityPool(pool).token0() == tokenIn
                ? IConcentratedLiquidityPool(pool).token1()
                : IConcentratedLiquidityPool(pool).token0();
        }

        if (overInput) {
            (maximumAmountIn, ) = calculateExactOutput(path, originalTokenIn, amountOut);
            if (exactAmountIn <= maximumAmountIn) {
                // @dev
                overInput = false;
            }
        }
    }

    function calculateExactInputSingle(
        address pool,
        address tokenIn,
        uint256 exactAmountIn
    )
        external
        view
        returns (
            uint256 amountOut,
            uint256 price,
            bool overInput,
            uint256 maximumAmountIn
        )
    {
        (amountOut, price, overInput) = SafeSwapHelperLib.exactInput(pool, tokenIn == address(0) ? wETH : tokenIn, exactAmountIn);

        if (overInput) {
            (maximumAmountIn, ) = calculateExactOutputSingle(pool, tokenIn, amountOut);
        }
    }

    function calculateExactOutput(
        address[] calldata path,
        address tokenIn,
        uint256 exactAmountOut
    ) public view returns (uint256 amountIn, uint256 price) {
        address tokenOut = findTokenOut(path, tokenIn);

        uint256 amountOut = exactAmountOut;
        for (uint256 i = path.length; i > 0; i--) {
            address pool = path[i - 1];

            tokenOut = IConcentratedLiquidityPool(pool).token0() == tokenOut
                ? IConcentratedLiquidityPool(pool).token1()
                : IConcentratedLiquidityPool(pool).token0();

            (amountOut, price) = SafeSwapHelperLib.exactOutput(pool, tokenOut, amountOut);
        }
        amountIn = amountOut;
    }

    function calculateExactOutputSingle(
        address pool,
        address tokenIn,
        uint256 exactAmountOut
    ) public view returns (uint256 amountIn, uint256 price) {
        return SafeSwapHelperLib.exactOutput(pool, tokenIn == address(0) ? wETH : tokenIn, exactAmountOut);
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
}
