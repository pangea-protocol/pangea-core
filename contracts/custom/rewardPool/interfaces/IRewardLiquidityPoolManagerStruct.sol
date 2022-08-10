// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../../../interfaces/IConcentratedLiquidityPoolManager.sol";

interface IRewardLiquidityPoolManagerStruct is IConcentratedLiquidityPoolManagerStruct {
    struct PositionReward {
        uint256 rewardGrowthInside; /// @dev The reward growth as of the last action on the individual position
        uint256 rewardOwed; /// @dev The amount of reward owed to the position as of the last computation
    }
}
