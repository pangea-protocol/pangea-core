import {TokenContracts, Tokens} from "./tokens";
import {ConcentratedLiquidityPoolManager} from "../../types";
import {BigNumber, BigNumberish} from "ethers";
import {PoolContracts, Pools} from "./pools";
import {TickMath} from "@uniswap/v3-sdk";
import Table from "cli-table3";
import {Signers, Users} from "./signers";

function denom(decimal: number) {
  return BigNumber.from(10).pow(decimal)
}

const TWO_POW_192 = BigNumber.from(2).pow(192);

export function convertToRatio(priceSqrtX96: BigNumber, decimal0: number, decimal1: number) {
  if (decimal0 > decimal1) {
    return priceSqrtX96.pow(2).mul(denom(decimal0 - decimal1)).mul(100000).div(TWO_POW_192).toNumber() / 100000
  } else {
    return priceSqrtX96.pow(2).div(denom(decimal1 - decimal0)).mul(100000).div(TWO_POW_192).toNumber() / 100000
  }
}

class PositionContracts {
  private static _instance: PositionContracts;

  public users!: Signers;
  public pools!: PoolContracts;
  public tokens!: TokenContracts;
  public poolManager!: ConcentratedLiquidityPoolManager;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    const {ethers} = require("hardhat");
    this.users = await Users();
    this.pools = await Pools();
    this.tokens = await Tokens();
    this.poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;
    return this;
  }

  public async info(positionId:BigNumberish) {
    const position = await this.position(positionId)
    const poolInfo = await this.pools.info(position.pool)

    const lower = convertToRatio(BigNumber.from(TickMath.getSqrtRatioAtTick(position.lower).toString()), poolInfo.token0.decimals, poolInfo.token1.decimals)
    const upper = convertToRatio(BigNumber.from(TickMath.getSqrtRatioAtTick(position.upper).toString()), poolInfo.token0.decimals, poolInfo.token1.decimals)
    const owner = await this.poolManager.ownerOf(positionId);
    const positionFee = await this.poolManager.positionFees(positionId);
    const fee0 = positionFee.token0amount;
    const fee1 = positionFee.token1amount;

    return {
      positionId: positionId,
      pool: poolInfo.address,
      token0: poolInfo.token0.symbol,
      token1: poolInfo.token1.symbol,
      owner,
      lower,
      upper,
      lowerTick: position.lower,
      upperTick: position.upper,
      liquidity: position.liquidity,
      fee0,
      fee1
    }
  }

  public async position(positionsId: BigNumberish) {
    return await this.poolManager.positions(positionsId)
  }

  public async positionTable(positionIds: BigNumberish[]) {
    const table = new Table({
      head: ["nftId", "owner", "pool", "token0", "token1", "lower", "upper", 'liquidity', 'fee0', 'fee1']
    });

    for (let positionId of positionIds) {
      const pInfo = await this.info(positionId);
      const row = [
        pInfo.positionId.toString(),
        this.users.from(pInfo.owner),
        pInfo.pool,
        pInfo.token0,
        pInfo.token1,
        pInfo.lower,
        pInfo.upper,
        pInfo.liquidity.toString(),
        pInfo.fee0.toString(),
        pInfo.fee1.toString()
      ];
      table.push(row);
    }
    return table;
  }

  public async all() {
    const total = await this.poolManager.totalSupply()
    const result: Promise<BigNumber>[] = []
    for (let i = 1; i < total.toNumber(); i++) {
      result.push(this.poolManager.tokenByIndex(i))
    }
    return Promise.all(result)
  }

  public async allOf(address:string) {
    const result:Promise<BigNumber>[] = []
    let total = await this.poolManager.balanceOf(address)
    for (let i=0;i<total.toNumber();i++) {
      result.push(this.poolManager.tokenOfOwnerByIndex(address, i))
    }
    return Promise.all(result)
  }
}


let instance: PositionContracts;
let semaphore = false;
export const Positions = async () => {
  if (!instance && !semaphore) {
    semaphore = true;
    instance = PositionContracts.Instance
    await instance.init()
  }
  return instance;
}
