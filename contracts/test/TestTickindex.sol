// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../libraries/TickIndex.sol";

contract TestTickindex {
    function adjust(
        IConcentratedLiquidityPool pool,
        int24 lowerOld,
        int24 lower,
        int24 upperOld,
        int24 upper
    )
        external
        view
        returns (
            int24,
            int24,
            int24,
            int24
        )
    {
        return TickIndex.adjust(pool, lowerOld, lower, upperOld, upper);
    }
}
