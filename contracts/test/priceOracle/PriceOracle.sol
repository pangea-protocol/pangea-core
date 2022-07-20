// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../libraries/FullMath.sol";
import "../../interfaces/IConcentratedLiquidityPoolFactory.sol";
import "../../interfaces/IConcentratedLiquidityPool.sol";
import "./IPriceOracle.sol";

/// @notice Simple Price Oracle for Test Environment
contract PriceOracle is IPriceOracle, OwnableUpgradeable {
    struct PairReserve {
        uint256 quoteReserve;
        uint256 baseReserve;
    }

    uint256 public constant DECIMAL = 6;

    IConcentratedLiquidityPoolFactory public poolFactory;
    address public wklay;
    address[] public stableCoins;

    function initialize(
        address _poolFactory,
        address _wklay,
        address[] memory _stableCoins
    ) external initializer {
        poolFactory = IConcentratedLiquidityPoolFactory(_poolFactory);
        wklay = _wklay;
        stableCoins = _stableCoins;
    }

    function consultKlayPrice() external view returns (uint256 price) {
        return _klayPrice();
    }

    function consultPrice(address token) external view returns (uint256 price) {
        if (token == address(0) || token == wklay) {
            return _klayPrice();
        }

        for (uint256 i = 0; i < stableCoins.length; i++) {
            if (stableCoins[i] == token) {
                return 10**DECIMAL;
            }
        }
        PairReserve memory reserve = aggregateStablePairReserve(token);

        PairReserve memory reserveFromKlay;
        {
            reserveFromKlay = aggregateKlayPairReserve(token);
            PairReserve memory klayStableReserve = aggregateKlayStableReserve();
            if (klayStableReserve.quoteReserve > 0) {
                reserveFromKlay.quoteReserve = FullMath.mulDiv(
                    reserveFromKlay.quoteReserve,
                    klayStableReserve.baseReserve,
                    klayStableReserve.quoteReserve
                );
            }
        }
        reserve.quoteReserve += reserveFromKlay.quoteReserve;
        reserve.baseReserve += reserveFromKlay.baseReserve;

        if (reserve.baseReserve == 0 || reserve.quoteReserve == 0) {
            return 0;
        }

        uint256 tokenDecimal = IERC20Metadata(token).decimals();
        if (tokenDecimal < 18) {
            return FullMath.mulDiv(reserve.quoteReserve, 10**DECIMAL, reserve.baseReserve * 10**(18 - tokenDecimal));
        } else {
            return FullMath.mulDiv(reserve.quoteReserve, 10**(DECIMAL + tokenDecimal - 18), reserve.baseReserve);
        }
    }

    function _klayPrice() internal view returns (uint256 price) {
        PairReserve memory reserve = aggregateKlayStableReserve();
        return FullMath.mulDiv(reserve.baseReserve, 10**DECIMAL, reserve.quoteReserve);
    }

    function aggregateKlayStableReserve() public view returns (PairReserve memory reserve) {
        reserve = PairReserve(0, 0);
        for (uint256 i = 0; i < stableCoins.length; i++) {
            address stableCoin = stableCoins[i];
            PairReserve memory temp = aggregateKlayPairReserve(stableCoin);
            reserve.quoteReserve += temp.quoteReserve;
            reserve.baseReserve += adjustDecimal(temp.baseReserve, stableCoin);
        }
    }

    function aggregateStablePairReserve(address token) public view returns (PairReserve memory reserve) {
        reserve = PairReserve(0, 0);
        for (uint256 i = 0; i < stableCoins.length; i++) {
            PairReserve memory temp = stablePairReserve(stableCoins[i], token);
            reserve.quoteReserve += temp.quoteReserve;
            reserve.baseReserve += temp.baseReserve;
        }
    }

    function aggregateKlayPairReserve(address token) public view returns (PairReserve memory) {
        PairReserve memory reserve = reserveFrom(wklay, token);
        return PairReserve(reserve.quoteReserve, reserve.baseReserve);
    }

    function adjustDecimal(uint256 amount, address stableCoin) internal view returns (uint256) {
        return amount * 10**(18 - IERC20Metadata(stableCoin).decimals());
    }

    function stablePairReserve(address stableCoin, address token) internal view returns (PairReserve memory) {
        PairReserve memory reserve = reserveFrom(stableCoin, token);
        return PairReserve(adjustDecimal(reserve.quoteReserve, stableCoin), reserve.baseReserve);
    }

    function reserveFrom(address token0, address token1) internal view returns (PairReserve memory) {
        if (address(poolFactory) == address(0)) return PairReserve(0, 0);

        address[] memory pools = poolFactory.getPools(token0, token1, 0, poolFactory.poolsCount(token0, token1));

        uint256 reserve0;
        uint256 reserve1;
        for (uint256 i = 0; i < pools.length; i++) {
            IConcentratedLiquidityPool pool = IConcentratedLiquidityPool(pools[i]);
            uint256 price = pool.price();
            uint256 liquidity = pool.liquidity();
            if (pool.token0() == token0) {
                reserve0 += FullMath.mulDiv(liquidity, 0x1000000000000000000000000, price);
                reserve1 += FullMath.mulDiv(liquidity, price, 0x1000000000000000000000000);
            } else {
                reserve0 += FullMath.mulDiv(liquidity, price, 0x1000000000000000000000000);
                reserve1 += FullMath.mulDiv(liquidity, 0x1000000000000000000000000, price);
            }
        }
        return PairReserve(reserve0, reserve1);
    }
}
