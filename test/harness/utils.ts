import { BigNumber } from "@ethersproject/bignumber";
import { TickMath } from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import { ConcentratedLiquidityPool, ERC20Test } from "../../types";
import { divRoundingUp } from "./helpers";

export async function getPriceAtTick(tick: number) {
  return BigNumber.from(TickMath.getSqrtRatioAtTick(tick).toString());
}

export function sortTokens(token0: ERC20Test, token1: ERC20Test) {
  return token0.address.toLowerCase() < token1.address.toLowerCase()
    ? [token0, token1]
    : [token1, token0];
}

export async function getTickAtCurrentPrice(pool: ConcentratedLiquidityPool) {
  const _price = (await pool.getPriceAndNearestTicks())._price;
  return TickMath.getTickAtSqrtRatio(JSBI.BigInt(_price));
}

export function getDy(
  liquidity: BigNumber,
  priceLower: BigNumber,
  priceUpper: BigNumber,
  roundUp: boolean
) {
  if (roundUp) {
    return divRoundingUp(
      liquidity.mul(priceUpper.sub(priceLower)),
      BigNumber.from("0x1000000000000000000000000")
    );
  } else {
    return liquidity
      .mul(priceUpper.sub(priceLower))
      .div("0x1000000000000000000000000");
  }
}

export function getDx(
  liquidity: BigNumber,
  priceLower: BigNumber,
  priceUpper: BigNumber,
  roundUp: boolean
) {
  if (roundUp) {
    return divRoundingUp(
      liquidity
        .mul("0x1000000000000000000000000")
        .mul(priceUpper.sub(priceLower))
        .div(priceUpper),
      priceLower
    );
  } else {
    return liquidity
      .mul("0x1000000000000000000000000")
      .mul(priceUpper.sub(priceLower))
      .div(priceUpper)
      .div(priceLower);
  }
}
