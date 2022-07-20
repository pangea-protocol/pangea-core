// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IPoolEventStruct {
    struct CreateLoggingParams {
        address token0;
        address token1;
        uint24 swapFee;
        uint160 price;
        uint24 tickSpacing;
    }

    struct LiquidityLoggingParams {
        int24 lower;
        int24 upper;
        uint256 amount0;
        uint256 amount1;
        uint256 liquidity;
    }

    struct CollectLoggingParams {
        uint256 amount0;
        uint256 amount1;
    }

    struct SwapLoggingParams {
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOut;
    }

    struct FlashLoggingParams {
        address sender;
        uint256 amount0;
        uint256 amount1;
        uint256 paid0;
        uint256 paid1;
    }
}
