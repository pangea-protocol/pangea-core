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

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IConcentratedLiquidityPoolManager.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/FullMath.sol";
import "../libraries/TickMath.sol";
import "../libraries/FixedPoint.sol";

contract PositionDashboard is Initializable {
    IConcentratedLiquidityPoolManager public poolManager;

    function initialize(
        address _poolManager
    ) external initializer {
        poolManager = IConcentratedLiquidityPoolManager(_poolManager);
    }

    function getTotal(uint256 positionId) external view returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = getPrincipal(positionId);
        (uint256 fee0, uint256 fee1) = getFees(positionId);
        amount0 += fee0;
        amount1 += fee1;
    }

    function getPrincipal(uint256 positionId) public view returns (uint256 amount0, uint256 amount1) {
        IConcentratedLiquidityPoolManagerStruct.Position memory position = poolManager.positions(positionId);

        uint256 priceLower = uint256(TickMath.getSqrtRatioAtTick(position.lower));
        uint256 priceUpper = uint256(TickMath.getSqrtRatioAtTick(position.upper));
        uint256 currentPrice = uint256(IConcentratedLiquidityPool(position.pool).price());

        (amount0, amount1) = DyDxMath.getAmountsForLiquidity(priceLower, priceUpper, currentPrice, position.liquidity, false);
    }

    function getFees(uint256 positionId) public view returns (uint256 fee0, uint256 fee1) {
        (fee0, fee1, , ) = poolManager.positionFees(positionId);
    }
}
