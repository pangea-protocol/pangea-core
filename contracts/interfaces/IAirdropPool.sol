// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IAirdropPool {
    function airdrop0PerSecond() external returns (uint256);

    function airdrop1PerSecond() external returns (uint256);

    function airdropStartTime() external returns (uint256);

    function airdropPeriod() external returns (uint256);
}
