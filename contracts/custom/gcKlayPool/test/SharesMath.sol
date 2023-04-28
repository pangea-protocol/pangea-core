// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8.0;

import '../../../libraries/FullMath.sol';

/**
 * @title SharesMath
 * @author Swapscanner
 * @dev This library provides functions to calculate shares and amount.
 */
library SharesMath {
    uint256 public constant PRECISION_MULTIPLIER = 1e27;

    function calculateShares(
        uint256 amount,
        uint256 totalSupply,
        uint256 totalShares
    ) internal pure returns (uint256 shares) {
        return
        totalSupply < 1 || totalShares < 1
        ? amount * PRECISION_MULTIPLIER
        : FullMath.mulDiv(amount, totalShares, totalSupply);
    }

    function calculateAmount(
        uint256 shares,
        uint256 totalSupply,
        uint256 totalShares
    ) internal pure returns (uint256 amount) {
        return
        totalSupply < 1 || totalShares < 1
        ? shares / PRECISION_MULTIPLIER
        : FullMath.mulDiv(totalSupply, shares, totalShares);
    }
}
