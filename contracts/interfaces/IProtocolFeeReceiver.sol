// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IProtocolFeeReceiver {
    function collectFeeCallback(address[] memory tokens, uint256[] memory amounts) external;
}
