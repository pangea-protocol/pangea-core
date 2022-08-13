import {TokenContracts, Tokens} from "./tokens";
import {IERC20Metadata, IRewardLiquidityPool, RewardLiquidityPoolManager} from "../../types";
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

class RewardPositionContracts {
  private static _instance: RewardPositionContracts;

  public users!: Signers;
  public pools!: PoolContracts;
  public tokens!: TokenContracts;
  public poolManager!: RewardLiquidityPoolManager;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    const {ethers} = require("hardhat");
    this.users = await Users();
    this.pools = await Pools();
    this.tokens = await Tokens();
    this.poolManager = await ethers.getContract("RewardLiquidityPoolManager") as RewardLiquidityPoolManager;
    return this;
  }

  public async info(positionId:BigNumberish) {
    const {ethers} = require("hardhat");
    const position = await this.position(positionId)
    const poolInfo = await this.pools.info(position.pool)
    const rewardToken = await (await ethers.getContractAt("RewardLiquidityPool", position.pool) as IRewardLiquidityPool).rewardToken();

    const lower = convertToRatio(BigNumber.from(TickMath.getSqrtRatioAtTick(position.lower).toString()), poolInfo.token0.decimals, poolInfo.token1.decimals)
    const upper = convertToRatio(BigNumber.from(TickMath.getSqrtRatioAtTick(position.upper).toString()), poolInfo.token0.decimals, poolInfo.token1.decimals)
    const owner = await this.poolManager.ownerOf(positionId);
    const positionFee = await this.poolManager.positionFees(positionId);
    const positionReward = await this.poolManager.positionRewardAmount(positionId);
    const fee0 = positionFee.token0amount;
    const fee1 = positionFee.token1amount;
    const reward = positionReward.rewardAmount;

    return {
      positionId: positionId,
      pool: poolInfo.address,
      token0: poolInfo.token0.symbol,
      token1: poolInfo.token1.symbol,
      rewardToken: await (await ethers.getContractAt("IERC20Metadata",rewardToken) as IERC20Metadata).symbol(),
      owner,
      lower,
      upper,
      lowerTick: position.lower,
      upperTick: position.upper,
      liquidity: position.liquidity,
      fee0,
      fee1,
      reward
    }
  }

  public async position(positionsId: BigNumberish) {
    return await this.poolManager.positions(positionsId)
  }

  public async positionTable(positionIds: BigNumberish[]) {
    const table = new Table({
      head: ["nftId", "owner", "pool", "token0", "token1", "rewardToken", "lower", "upper", 'liquidity', 'fee0', 'fee1', 'reward']
    });

    for (let positionId of positionIds) {
      const pInfo = await this.info(positionId);
      const row = [
        pInfo.positionId.toString(),
        this.users.from(pInfo.owner),
        pInfo.pool,
        pInfo.token0,
        pInfo.token1,
        pInfo.rewardToken,
        pInfo.lower,
        pInfo.upper,
        pInfo.liquidity.toString(),
        pInfo.fee0.toString(),
        pInfo.fee1.toString(),
        pInfo.reward.toString()
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


let instance: RewardPositionContracts;
let semaphore = false;
export const RewardPositions = async () => {
  if (!instance && !semaphore) {
    semaphore = true;
    instance = RewardPositionContracts.Instance
    await instance.init()
  }
  return instance;
}
