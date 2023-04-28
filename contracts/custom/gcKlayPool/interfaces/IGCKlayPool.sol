// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IGCKlayPool {
    struct PositionReward {
        /// @dev reward growth of rewardToken inside the tick range as of the last mint/burn/collect
        uint256 rewardGrowthInsideLast;
        /// @dev computed amount of reward owed to the position as of the last mint/burn/collect
        uint128 rewardOwed;
    }

    struct FlashCache {
        uint256 amount0;
        uint256 amount1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 flashFee0;
        uint256 flashFee1;
        uint256 liquidity;
    }

    function registerRewardToken(address _token) external;
}
