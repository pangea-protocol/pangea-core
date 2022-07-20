// SPDX-License-Identifier: GPL-2.0-or-later

pragma solidity >=0.8.0;

import "./FullMath.sol";
import "./FixedPoint.sol";

/// @notice Math library that facilitates fee handling for Concentrated Liquidity Pools.
library FeeLib {
    function handleSwapFee(
        uint256 output,
        uint24 swapFee,
        uint256 protocolFeeRate,
        uint256 currentLiquidity,
        uint256 totalSwapFeeAmount,
        uint256 amountOut,
        uint256 protocolFee,
        uint256 feeGrowthGlobal
    )
        internal
        pure
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        uint256 swapFeeAmount = FullMath.mulDivRoundingUp(output, swapFee, 1e6);

        totalSwapFeeAmount += swapFeeAmount;

        amountOut += output - swapFeeAmount;

        // Calculate `protocolFeeRate` and convert pips to bips.
        uint256 feeDelta = FullMath.mulDivRoundingUp(swapFeeAmount, protocolFeeRate, 1e4);

        protocolFee += feeDelta;

        // Updating `feeAmount` based on the protocolFee.
        swapFeeAmount -= feeDelta;

        feeGrowthGlobal += FullMath.mulDiv(swapFeeAmount, FixedPoint.Q128, currentLiquidity);

        return (totalSwapFeeAmount, amountOut, protocolFee, feeGrowthGlobal);
    }

    function calculateFlashFee(
        uint256 amount0,
        uint256 amount1,
        uint24 feeRate
    ) internal pure returns (uint256 flashFee0, uint256 flashFee1) {
        flashFee0 = FullMath.mulDivRoundingUp(amount0, feeRate, 1e6);
        flashFee1 = FullMath.mulDivRoundingUp(amount1, feeRate, 1e6);
    }
}
