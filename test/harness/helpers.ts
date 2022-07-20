import { ethers } from "hardhat";
import { BaseContract, BigNumber, BigNumberish } from "ethers";
import { expect } from "chai";

export const ZERO = BigNumber.from(0);
export const ONE = BigNumber.from(1);
export const TWO = BigNumber.from(2);

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

export function expectAlmostEqual(actual, expected, reason = "") {
  expect(actual).to.be.within(expected.sub(ONE), expected.add(ONE), reason);
}

export function encodedAddress(account) {
  return ethers.utils.defaultAbiCoder.encode(["address"], [account.address]);
}

// Defaults to e18 using amount * 10^18
export function getBigNumber(amount: BigNumberish, decimals = 18): BigNumber {
  return BigNumber.from(amount).mul(BigNumber.from(10).pow(decimals));
}

export function sqrt(x) {
  let z = x.add(ONE).div(TWO);
  let y = x;
  while (z.sub(y).isNegative()) {
    y = z;
    z = x.div(z).add(z).div(TWO);
  }
  return y;
}

export function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function encodedSwapData(tokenIn, to, unwrap) {
  return ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "bool"],
    [tokenIn, to, unwrap]
  );
}

export function encodeCreatePoolData(
  token0: BaseContract,
  token1: BaseContract,
  swapFee: BigNumberish,
  price: BigNumberish,
  tickSpacing: BigNumberish
) {
  return ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "uint24", "uint160", "uint24"],
    [
      token0.address,
      token1.address,
      BigNumber.from(swapFee),
      price,
      BigNumber.from(tickSpacing),
    ]
  );
}

export function printHumanReadable(arr) {
  console.log(
    arr.map((x) => {
      let paddedX = x.toString().padStart(19, "0");
      paddedX =
        paddedX.substr(0, paddedX.length - 18) +
        "." +
        paddedX.substr(paddedX.length - 18) +
        " ";
      return paddedX;
    })
  );
}

export function getFactories(contracts: string[]) {
  return contracts.map((contract) => getFactory(contract));
}

export function getFactory(contract: string) {
  return ethers.getContractFactory(contract);
}

export function sortTokens<T extends BaseContract>(tokens: T[]): T[] {
  return tokens.sort((a, b) => (a.address < b.address ? -1 : 1));
}

export function divRoundingUp(
  numba: BigNumber,
  denominator: BigNumberish
): BigNumber {
  const res = numba.div(denominator);
  const remainder = numba.mod(denominator);
  if (remainder.eq(0)) return res;
  return res.add(1);
}
