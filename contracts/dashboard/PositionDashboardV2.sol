// SPDX-License-Identifier: GPL-3.0

/*
 *
 * #####    ##   #    #  ####  ######   ##      #####  #####   ####  #####  ####   ####   ####  #
 * #    #  #  #  ##   # #    # #       #  #     #    # #    # #    #   #   #    # #    # #    # #
 * #    # #    # # #  # #      #####  #    #    #    # #    # #    #   #   #    # #      #    # #
 * #####  ###### #  # # #  ### #      ######    #####  #####  #    #   #   #    # #      #    # #
 * #      #    # #   ## #    # #      #    #    #      #   #  #    #   #   #    # #    # #    # #
 * #      #    # #    #  ####  ###### #    #    #      #    #  ####    #    ####   ####   ####  ######
 *
 */

pragma solidity >=0.8.0;

import "../custom/miningPool/interfaces/IMiningPoolManager.sol";
import "../custom/miningPool/interfaces/IMiningPool.sol";
import "../interfaces/IConcentratedLiquidityPoolManager.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/FullMath.sol";
import "../libraries/TickMath.sol";
import "../libraries/FixedPoint.sol";

contract PositionDashboardV2 {
    function getTotal(address poolManager, uint256 positionId) external view returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = getPrincipal(poolManager, positionId);
        (uint256 fee0, uint256 fee1) = getFees(poolManager, positionId);
        amount0 += fee0;
        amount1 += fee1;
    }

    function getPrincipal(address poolManager, uint256 positionId) public view returns (uint256 amount0, uint256 amount1) {
        IConcentratedLiquidityPoolManagerStruct.Position memory position = IConcentratedLiquidityPoolManager(poolManager).positions(
            positionId
        );

        uint256 priceLower = uint256(TickMath.getSqrtRatioAtTick(position.lower));
        uint256 priceUpper = uint256(TickMath.getSqrtRatioAtTick(position.upper));
        uint256 currentPrice = uint256(IConcentratedLiquidityPool(position.pool).price());

        (amount0, amount1) = DyDxMath.getAmountsForLiquidity(priceLower, priceUpper, currentPrice, position.liquidity, false);
    }

    function getFees(address poolManager, uint256 positionId) public view returns (uint256 fee0, uint256 fee1) {
        (fee0, fee1, , ) = IConcentratedLiquidityPoolManager(poolManager).positionFees(positionId);
    }

    function getRewards(address poolManager, uint256 positionId) public view returns (address rewardToken, uint256 rewardAmount) {
        IConcentratedLiquidityPoolManagerStruct.Position memory position = IMiningPoolManager(poolManager).positions(positionId);
        rewardToken = IMiningPool(position.pool).rewardToken();
        (rewardAmount, ) = IMiningPoolManager(poolManager).positionRewardAmount(positionId);
    }
}
