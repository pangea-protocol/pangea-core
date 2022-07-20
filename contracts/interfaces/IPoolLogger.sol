// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "./IPoolEventStruct.sol";

interface IPoolLogger is IPoolEventStruct {
    event Mint(address indexed pool, int24 lower, int24 upper, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed pool, int24 lower, int24 upper, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Collect(address indexed pool, uint256 amount0, uint256 amount1);
    event Swap(address indexed pool, bool zeroForOne, uint256 amountIn, uint256 amountOut);
    event Flash(address indexed pool, address indexed sender, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1);

    function emitMint(LiquidityLoggingParams memory params) external;

    function emitBurn(LiquidityLoggingParams memory params) external;

    function emitCollect(CollectLoggingParams memory params) external;

    function emitSwap(SwapLoggingParams memory params) external;

    function emitFlash(FlashLoggingParams memory params) external;
}
