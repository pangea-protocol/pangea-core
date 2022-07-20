// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IPoolFlashCallback.sol";
import "../../interfaces/IConcentratedLiquidityPool.sol";

contract FlashCallbackMock is IPoolFlashCallback {
    IConcentratedLiquidityPool private pool;
    uint256 private cachedAmount0;
    uint256 private cachedAmount1;

    constructor(address _pool) {
        pool = IConcentratedLiquidityPool(_pool);
    }

    function callFlash(
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        cachedAmount0 = amount0;
        cachedAmount1 = amount1;
        pool.flash(address(this), amount0, amount1, data);
    }

    function flashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external {
        (uint256 delta0, uint256 delta1) = abi.decode(data, (uint256, uint256));
        IERC20(pool.token0()).transfer(address(pool), cachedAmount0 + delta0);
        IERC20(pool.token1()).transfer(address(pool), cachedAmount1 + delta1);
    }
}
