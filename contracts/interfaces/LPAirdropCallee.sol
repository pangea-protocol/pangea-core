// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

// @notice It's for ConcentratedLiquidityPool. supports only tokens of pool
interface LPAirdropCallee {
    function depositAirdrop(
        uint128 airdrop0,
        uint128 airdrop1,
        uint256 startTime,
        uint256 period
    ) external;
}

// @notice It's for ConcentratedLiquidityPool. supports tokens of pool and reward Token
interface LPRewardCallee {
    function rewardToken() external view returns (address);

    function depositAirdropAndReward(
        uint128 airdrop0,
        uint128 airdrop1,
        uint128 reward,
        uint256 startTime,
        uint256 period
    ) external;
}
