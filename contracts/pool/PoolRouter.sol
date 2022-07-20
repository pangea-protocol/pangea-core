// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IPoolRouter.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/IConcentratedLiquidityPool.sol";
import "../abstract/PangeaBatchable.sol";
import "../abstract/PangeaPermit.sol";
import "../libraries/SwapHelperLib.sol";

/// @notice Router contract that helps in swapping across pools.
contract PoolRouter is PangeaPermit, PangeaBatchable, IPoolRouter, Initializable {
    using SafeERC20 for IERC20;

    /// @notice master deployer contract.
    IMasterDeployer public masterDeployer;
    /// @notice ERC-20 token for wrapped KLAY (v10).
    address payable internal wETH;
    /// @notice The user should use 0x0 if they want to deposit KLAY
    address constant USE_KLAY = address(0);

    mapping(address => bool) internal whitelistedPools;

    // Custom Errors
    error TooLittleReceived();
    error TooLittleAmountIn();
    error InvalidPool();

    function initialize(address _masterDeployer, address _wETH) external initializer {
        masterDeployer = IMasterDeployer(_masterDeployer);
        wETH = payable(_wETH);
    }

    /// @notice Swaps amountIn of one token for as much as possible of another token
    /// @param params (uint256 amountIn,uint256 amountOutMinimum, address pool, address tokenIn, address to, bool unwrap)
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        _transfer(params.tokenIn, msg.sender, params.pool, params.amountIn);

        IConcentratedLiquidityPool pool = IConcentratedLiquidityPool(params.pool);
        isWhiteListed(address(pool));
        address tokenIn = params.tokenIn == USE_KLAY ? wETH : params.tokenIn;

        bool zeroForOne = pool.token0() == tokenIn;

        if (params.unwrap) {
            amountOut = pool.swap(abi.encode(zeroForOne, address(this)));
            IWETH(wETH).withdrawTo(payable(params.to), amountOut);
        } else {
            amountOut = pool.swap(abi.encode(zeroForOne, params.to));
        }

        if (amountOut < params.amountOutMinimum) revert TooLittleReceived();
    }

    /// @notice Swaps token A to token B indirectly by using multiple hops.
    /// @param params (uint256 amountIn,uint256 amountOutMinimum, address[] path, address tokenIn, address to, bool unwrap)
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        _transfer(params.tokenIn, msg.sender, params.path[0], params.amountIn);

        address tokenIn = params.tokenIn == USE_KLAY ? wETH : params.tokenIn;
        uint256 pathLength = params.path.length;
        IConcentratedLiquidityPool pool;
        bool zeroForOne;
        for (uint256 i = 0; i < pathLength - 1; i = _increment(i)) {
            pool = IConcentratedLiquidityPool(params.path[i]);
            isWhiteListed(address(pool));

            zeroForOne = pool.token0() == tokenIn;
            amountOut = pool.swap(abi.encode(zeroForOne, params.path[i + 1]));
            tokenIn = zeroForOne ? pool.token1() : pool.token0(); // nextTokenIn
        }

        pool = IConcentratedLiquidityPool(params.path[pathLength - 1]);
        isWhiteListed(address(pool));

        zeroForOne = pool.token0() == tokenIn;
        if (params.unwrap) {
            amountOut = pool.swap(abi.encode(zeroForOne, address(this)));
            IWETH(wETH).withdrawTo(payable(params.to), amountOut);
        } else {
            amountOut = pool.swap(abi.encode(zeroForOne, params.to));
        }

        // @dev Ensure that the slippage wasn't too much. This assumes that the pool is honest.
        if (amountOut < params.amountOutMinimum) revert TooLittleReceived();
    }

    /// @notice Swaps as little as possible of one token for `amountOut` of another token
    /// @param params The parameters necessary for the swap, encoded as ExactOutputSingleParams in calldata
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn) {
        address tokenIn = params.tokenIn == USE_KLAY ? wETH : params.tokenIn;
        (amountIn, ) = SwapHelperLib.exactOutput(params.pool, tokenIn, params.amountOut);
        if (params.amountInMaximum < amountIn) revert TooLittleAmountIn();
        if (params.tokenIn == USE_KLAY) {
            if (msg.value < amountIn) revert TooLittleAmountIn();
            IWETH(wETH).depositTo{value: (msg.value - amountIn)}(msg.sender);
        }

        _transfer(params.tokenIn, msg.sender, params.pool, amountIn);

        IConcentratedLiquidityPool pool = IConcentratedLiquidityPool(params.pool);
        isWhiteListed(address(pool));

        bool zeroForOne = pool.token0() == tokenIn;

        uint256 amountOut;
        if (params.unwrap) {
            amountOut = pool.swap(abi.encode(zeroForOne, address(this)));
            IWETH(wETH).withdrawTo(payable(params.to), amountOut);
        } else {
            amountOut = pool.swap(abi.encode(zeroForOne, params.to));
        }

        /// @dev it won't happen, but for safety
        if (amountOut < params.amountOut) revert TooLittleReceived();
    }

    /// @notice Swaps as little as possible of one token for `amountOut` of another token
    /// @param params The parameters necessary for the swap, encoded as ExactOutputSingleParams in calldata
    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn) {
        amountIn = calculateAmountIn(params.path, params.tokenIn, params.amountOut);
        if (params.amountInMaximum < amountIn) revert TooLittleAmountIn();

        bool needToWrap = params.tokenIn == USE_KLAY;
        if (needToWrap) {
            if (msg.value < amountIn) revert TooLittleAmountIn();
            safeTransferETH(msg.sender, msg.value - amountIn);
        }
        _transfer(params.tokenIn, msg.sender, params.path[0], amountIn);

        address tokenIn = needToWrap ? wETH : params.tokenIn;
        uint256 pathLength = params.path.length;
        uint256 amountOut;
        bool zeroForOne;
        IConcentratedLiquidityPool pool;
        for (uint256 i = 0; i < pathLength - 1; i = _increment(i)) {
            pool = IConcentratedLiquidityPool(params.path[i]);
            isWhiteListed(address(pool));

            zeroForOne = pool.token0() == tokenIn;
            amountOut = pool.swap(abi.encode(zeroForOne, params.path[i + 1]));
            tokenIn = zeroForOne ? pool.token1() : pool.token0(); // nextTokenIn
        }

        pool = IConcentratedLiquidityPool(params.path[pathLength - 1]);
        isWhiteListed(address(pool));

        zeroForOne = pool.token0() == tokenIn;
        if (params.unwrap) {
            amountOut = pool.swap(abi.encode(zeroForOne, address(this)));
            IWETH(wETH).withdrawTo(payable(params.to), amountOut);
        } else {
            amountOut = pool.swap(abi.encode(zeroForOne, params.to));
        }

        /// @dev it won't happen, but for safety
        if (amountOut < params.amountOut) revert TooLittleReceived();
    }

    /// @notice Recover mistakenly sent tokens.
    function sweep(
        address token,
        uint256 amount,
        address recipient
    ) external payable {
        if (token == USE_KLAY) {
            // slither-disable-next-line arbitrary-send
            IWETH(wETH).depositTo{value: amount}(recipient);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    function _transfer(
        address token,
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        if (token == USE_KLAY) {
            // slither-disable-next-line arbitrary-send
            IWETH(wETH).depositTo{value: amount}(recipient);
        } else {
            IERC20(token).safeTransferFrom(sender, recipient, amount);
        }
    }

    function calculateAmountIn(
        address[] calldata path,
        address tokenIn,
        uint256 amountOut
    ) internal view returns (uint256 amountIn) {
        address tokenOut = findTokenOut(path, tokenIn);
        IConcentratedLiquidityPool pool;
        for (uint256 i = path.length; i > 0; i--) {
            pool = IConcentratedLiquidityPool(path[i - 1]);
            tokenOut = pool.token0() == tokenOut ? pool.token1() : pool.token0();
            (amountOut, ) = SwapHelperLib.exactOutput(address(pool), tokenOut, amountOut);
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

    function isWhiteListed(address pool) internal {
        if (!whitelistedPools[pool]) {
            if (!masterDeployer.pools(pool)) revert InvalidPool();
            whitelistedPools[pool] = true;
        }
    }

    /// @dev increment helper
    function _increment(uint256 x) private pure returns (uint256) {
        // Cannot realistically overflow
        unchecked {
            return x + 1;
        }
    }

    function safeTransferETH(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH_TRANSFER_FAILED");
    }
}
