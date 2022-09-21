import {convertPrice, TokenContracts, Tokens} from "./tokens";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolHelper,
  MasterDeployer
} from "../../types";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";

function denom(decimal:number) {
  return BigNumber.from(10).pow(decimal)
}
const TWO_POW_192 = BigNumber.from(2).pow(192);

export function convertToRatio(priceSqrtX96:BigNumber, decimal0:number, decimal1:number) {
  if (decimal0 > decimal1) {
    return priceSqrtX96.pow(2).mul(denom(decimal0-decimal1)).mul(100000).div(TWO_POW_192).toNumber() / 100000
  } else {
    return priceSqrtX96.pow(2).div(denom(decimal1-decimal0)).mul(100000).div(TWO_POW_192).toNumber() / 100000
  }
}

export class PoolContracts {
  private static _instance: PoolContracts;

  public masterDeployer!: MasterDeployer;
  public tokens!: TokenContracts;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    const {ethers} = require("hardhat");
    this.tokens = await Tokens();
    this.masterDeployer = await ethers.getContract("MasterDeployer") as MasterDeployer;
    return this;
  }

  public async info(address:string) {
    const pool = await this.from(address)

    const immutables = await pool.getImmutables()
    const reserves = await pool.getReserves()
    const priceInfo = await pool.getPriceAndNearestTicks()

    const reserve0Value = await convertPrice(immutables._token0, reserves._reserve0);
    const reserve1Value = await convertPrice(immutables._token1, reserves._reserve1);

    const token0 = await this.tokens.info(immutables._token0)
    const token1 = await this.tokens.info(immutables._token1)

    return {
      address,
      token0,
      token1,
      factory: immutables._factory,
      price: convertToRatio(priceInfo._price, token0.decimals, token1.decimals),
      nearestTick: priceInfo._nearestTick,
      tickSpacing: immutables._tickSpacing,
      swapFee: immutables._swapFee,
      reserve0: reserves._reserve0,
      reserve1: reserves._reserve1,
      totalValueLock: reserve0Value.add(reserve1Value)
    }
  }

  public async ticks(address:string) {
    const {ethers} = require("hardhat");
    const poolHelper = await ethers.getContract("ConcentratedLiquidityPoolHelper") as ConcentratedLiquidityPoolHelper;
    return await poolHelper.getTickStateDetail(address)
  }

  public async from(address:string) {
    const {ethers} = require("hardhat");
    return await ethers.getContractAt("ConcentratedLiquidityPool",address) as ConcentratedLiquidityPool;
  }

  async allPools() {
    const result:string[] = []
    const poolCounts = (await this.masterDeployer.totalPoolsCount()).toNumber()
    for (let i=0;i<poolCounts;i++) {
      result.push(await this.masterDeployer.getPoolAddress(i))
    }
    return result;
  }
}


let instance: PoolContracts;
let semaphore = false;
export const Pools = async () => {
  if (!instance && !semaphore) {
    semaphore = true;
    instance = PoolContracts.Instance
    await instance.init()
  }
  return instance;
}
