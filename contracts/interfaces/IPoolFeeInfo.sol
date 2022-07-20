// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IPoolFeeInfo {
    function protocolFee() external view returns (uint256);

    function swapFee() external view returns (uint24);
}
