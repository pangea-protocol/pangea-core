// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../../../interfaces/IConcentratedLiquidityPoolManager.sol";

interface IRewardLiquidityPoolManagerEvent is IConcentratedLiquidityPoolManagerEvent {
    event CollectReward(address indexed pool, address indexed recipient, uint256 indexed positionId, uint256 amount);
}
