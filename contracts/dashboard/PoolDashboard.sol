// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IAirdropDistributor.sol";
import "../interfaces/IMasterDeployer.sol";
import {IConcentratedLiquidityPool, IConcentratedLiquidityPoolStruct} from "../interfaces/IConcentratedLiquidityPool.sol";
import "../interfaces/IAirdropPool.sol";
import "../interfaces/IPoolFeeInfo.sol";
import "../libraries/FullMath.sol";
import "../libraries/TickMath.sol";
import "../libraries/FixedPoint.sol";

/// @notice
contract PoolDashboard is Initializable {
    IMasterDeployer public masterDeployer;
    IAirdropDistributor public airdropDistributor;

    error NotPool();

    modifier verifyPool(address pool) {
        if (!masterDeployer.pools(pool)) revert NotPool();
        _;
    }

    function initialize(address _masterDeployer, address _airdropDistributor) external initializer {
        masterDeployer = IMasterDeployer(_masterDeployer);
        airdropDistributor = IAirdropDistributor(_airdropDistributor);
    }

    /// @notice returns cumulative fees earned so far from the pool
    /// @dev fee = swap Fee + flash Fee + airdrop Reward
    function cumulativeFees(address pool) public view verifyPool(pool) returns (uint256 fee0, uint256 fee1) {
        (uint256 down0, uint256 down1) = cumulativeFeesDownSide(pool);
        (uint256 up0, uint256 up1) = cumulativeFeesUpSide(pool);
        fee0 = down0 + up0;
        fee1 = down1 + up1;
    }

    /// @notice returns cumulative fees except airdrop earned so far from the pool
    /// @dev trading fee = swap Fee + flash Fee
    function cumulativeTradingFees(address pool) public view verifyPool(pool) returns (uint256 tradingFee0, uint256 tradingFee1) {
        (uint256 fee0, uint256 fee1) = cumulativeFees(pool);
        (uint256 airdrop0, uint256 airdrop1) = cumulativeAirdrop(pool);
        // if the liquidity of pool is zero, airdrop can be greater than fee, but it's edge case
        tradingFee0 = fee0 >= airdrop0 ? fee0 - airdrop0 : 0;
        tradingFee1 = fee1 >= airdrop1 ? fee1 - airdrop1 : 0;
    }

    /// @notice returns total airdrop earned so far from the pool
    /// @dev undistributed and deposited volumes are excluded
    function cumulativeAirdrop(address pool) public view verifyPool(pool) returns (uint256 airdrop0, uint256 airdrop1) {
        uint256 length = airdropDistributor.airdropSnapshotLength(pool);
        for (uint256 i = 0; i < length; i++) {
            // airdrop snapshot history
            IAirdropDistributorStruct.AirdropInfo memory snapshot = airdropDistributor.airdropSnapshot(pool, i);

            if (snapshot.startTime + 1 weeks < block.timestamp) {
                // airdrop finished
                airdrop0 += snapshot.amount0;
                airdrop1 += snapshot.amount1;
            } else {
                // ongoing airdrop
                uint256 diff = block.timestamp > snapshot.startTime ? block.timestamp - snapshot.startTime : 0;
                if (diff >= 604800) {
                    // 1 weeks = 604800
                    airdrop0 += snapshot.amount0;
                    airdrop1 += snapshot.amount1;
                } else {
                    airdrop0 += FullMath.mulDiv(snapshot.amount0, diff, 1 weeks);
                    airdrop1 += FullMath.mulDiv(snapshot.amount1, diff, 1 weeks);
                }
            }
        }
    }

    /// @notice returns cumulative trading volume from cumulative fees
    /// @dev The trading volume is calculated based on the swap output, not swap input
    function cumulativeTradingVolume(address pool) public view verifyPool(pool) returns (uint256 tradingVolume0, uint256 tradingVolume1) {
        (uint256 tradingFee0, uint256 tradingFee1) = cumulativeTradingFees(pool);

        // fee rate of Liquidity Provider (1e6 = 100%)
        uint256 swapFee = uint256(IPoolFeeInfo(pool).swapFee());
        uint256 protocolFee = IPoolFeeInfo(pool).protocolFee();
        uint256 feeRate = FullMath.mulDiv(swapFee, 1e4 - protocolFee, 1e4);

        tradingVolume0 = FullMath.mulDiv(FullMath.mulDiv(tradingFee0, 1e6, feeRate), 1e6 - swapFee, 1e6);
        tradingVolume1 = FullMath.mulDiv(FullMath.mulDiv(tradingFee1, 1e6, feeRate), 1e6 - swapFee, 1e6);
    }

    function cumulativeFeesDownSide(address pool) private view returns (uint256 fee0, uint256 fee1) {
        int24 nearestTick = IConcentratedLiquidityPool(pool).nearestTick();
        uint128 liquidity = IConcentratedLiquidityPool(pool).liquidity();

        uint24 tickSpacing = IConcentratedLiquidityPool(pool).tickSpacing();
        while (nearestTick != TickMath.MIN_TICK) {
            IConcentratedLiquidityPoolStruct.Tick memory tick = IConcentratedLiquidityPool(pool).ticks(nearestTick);
            if ((nearestTick / int24(tickSpacing)) % 2 == 0) {
                liquidity -= tick.liquidity;
            } else {
                liquidity += tick.liquidity;
            }
            (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1) = IConcentratedLiquidityPool(pool).rangeFeeGrowth(
                tick.previousTick,
                nearestTick
            );

            fee0 += FullMath.mulDiv(liquidity, feeGrowthGlobal0, FixedPoint.Q128);
            fee1 += FullMath.mulDiv(liquidity, feeGrowthGlobal1, FixedPoint.Q128);

            nearestTick = tick.previousTick;
        }
    }

    function cumulativeFeesUpSide(address pool) private view returns (uint256 fee0, uint256 fee1) {
        int24 nearestTick = IConcentratedLiquidityPool(pool).nearestTick();
        uint128 liquidity = IConcentratedLiquidityPool(pool).liquidity();

        uint24 tickSpacing = IConcentratedLiquidityPool(pool).tickSpacing();
        while (nearestTick != TickMath.MAX_TICK) {
            IConcentratedLiquidityPoolStruct.Tick memory tick = IConcentratedLiquidityPool(pool).ticks(nearestTick);
            (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1) = IConcentratedLiquidityPool(pool).rangeFeeGrowth(
                nearestTick,
                tick.nextTick
            );

            fee0 += FullMath.mulDiv(liquidity, feeGrowthGlobal0, FixedPoint.Q128);
            fee1 += FullMath.mulDiv(liquidity, feeGrowthGlobal1, FixedPoint.Q128);

            nearestTick = tick.nextTick;
            uint128 tickLiquidity = IConcentratedLiquidityPool(pool).ticks(nearestTick).liquidity;
            if ((nearestTick / int24(tickSpacing)) % 2 == 0) {
                liquidity += tickLiquidity;
            } else {
                liquidity -= tickLiquidity;
            }
        }
    }
}
