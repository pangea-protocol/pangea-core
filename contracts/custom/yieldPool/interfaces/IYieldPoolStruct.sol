// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IYieldPoolStruct {
    struct PositionReward {
        /// @dev reward growth of rewardToken inside the tick range as of the last mint/burn/collect
        uint256 rewardGrowthInsideLast;
        /// @dev computed amount of reward owed to the position as of the last mint/burn/collect
        uint128 rewardOwed;
    }
}
