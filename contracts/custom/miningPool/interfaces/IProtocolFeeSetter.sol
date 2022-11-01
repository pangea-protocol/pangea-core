// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IProtocolFeeSetter {
    function setProtocolFee(uint256 _protocolFee) external;
}
