// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IRewardLiquidityPoolManagerEvent {
    event IncreaseLiquidity(address indexed pool, address indexed owner, uint256 indexed positionId, uint256 amount0, uint256 amount1, uint128 liquidity);

    event DecreaseLiquidity(address indexed pool, address indexed owner, uint256 indexed positionId, uint256 amount0, uint256 amount1, uint128 liquidity);

    event CollectFeeWithReward(address indexed pool, address indexed recipient, uint256 indexed positionId, uint256 amount0, uint256 amount1, uint256 reward);
}
