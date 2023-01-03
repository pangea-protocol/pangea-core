// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../../../interfaces/IConcentratedLiquidityPoolManager.sol";

interface IMiningPoolManager is IConcentratedLiquidityPoolManager {
    function positionRewardAmount(uint256 positionId) external view returns (uint256 rewardAmount, uint256 rewardGrowthInside);
}
