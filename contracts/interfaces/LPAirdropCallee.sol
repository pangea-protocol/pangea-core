// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface LPAirdropCallee {
    function depositAirdrop(
        uint128 airdrop0,
        uint128 airdrop1,
        uint256 startTime,
        uint256 period
    ) external;
}
