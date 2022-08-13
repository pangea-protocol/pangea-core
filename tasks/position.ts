import {task, types} from "hardhat/config";
import {advanceBlock, doExecute} from "./harness/utilites";
import {Pools} from "./harness/pools";
import {Tokens} from "./harness/tokens";
import {Users} from "./harness/signers";
import {Positions} from "./harness/positions";
import {sqrt} from "@uniswap/sdk-core";
import JSBI from "jsbi";
import {ConcentratedLiquidityPoolManager, IRewardLiquidityPool, RewardLiquidityPoolManager} from "../types";
import {ethers} from "hardhat";
import {BigNumber} from "@ethersproject/bignumber";
import {TickMath} from "@uniswap/v3-sdk";
import {RewardPositions} from "./harness/rewardPositions";

task("position:mint", "mint a new position NFT")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("pool")
    .addPositionalParam("lowerRate", "Min price range, Current Price Base Ratio (10000 = 100%)")
    .addPositionalParam("upperRate", "Max price range, Current Price Base Ratio (10000 = 100%)")
    .addPositionalParam("amount0Desired")
    .addPositionalParam("amount1Desired")
    .addPositionalParam("minLiquidity", "slippage", 0, types.int)
    .addPositionalParam("positionId","",0,types.int)
    .setAction(async (
        {owner, pool, lowerRate, upperRate, amount0Desired, amount1Desired, minLiquidity, positionId},
        {ethers}
    ) => {
      await advanceBlock();

      const pools = await Pools();
      const tokens = await Tokens();
      const users = await Users();
      const positions = await Positions();

      const user = users.signerFrom(owner);

      const poolContract = await pools.from(pool);
      const info = await pools.info(pool);

      const token0 = await tokens.from(info.token0.address)
      const token1 = await tokens.from(info.token1.address)

      const _price = (await poolContract.getPriceAndNearestTicks())._price;
      // @ts-ignore
      const _lowerPrice = _price.mul(sqrt(JSBI.BigInt(lowerRate * 10000)).toString()).div(10000)
      // @ts-ignore
      const _upperPrice = _price.mul(sqrt(JSBI.BigInt(upperRate * 10000)).toString()).div(10000)

      const lower = getNearestLowerValidTick(_lowerPrice, info.tickSpacing);
      const upper = getNearestUpperValidTick(_upperPrice, info.tickSpacing);

      const poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;
      if (token0.address == tokens.wklay.address || token1.address == tokens.wklay.address) {
        if (token0.address != tokens.wklay.address) {
          await doExecute(token0.connect(user).approve(poolManager.address, amount0Desired));
          await doExecute(poolManager.connect(user).mintNative(
              pool,
              lower,
              lower,
              upper,
              upper,
              amount0Desired,
              minLiquidity,
              positionId
              , {value: amount1Desired}))
        } else {
          await doExecute(token1.connect(user).approve(poolManager.address, amount1Desired));
          await doExecute(poolManager.connect(user).mintNative(
              pool,
              lower,
              lower,
              upper,
              upper,
              amount1Desired,
              minLiquidity,
              positionId
              , {value: amount0Desired}))
        }
      } else {
        await doExecute(token0.connect(user).approve(poolManager.address,amount0Desired));
        await doExecute(token1.connect(user).approve(poolManager.address, amount1Desired));
        await doExecute(poolManager.connect(user).mint(
            pool,
            lower,
            lower,
            upper,
            upper,
            amount0Desired,
            amount1Desired,
            minLiquidity,
            positionId
        ))
      }

      const allPositions = await positions.allOf(user.address);
      const table = await positions.positionTable(allPositions);
      console.log(table.toString());
    });

task("position:addLiquidity", "add liquidity to existing position")
    .addPositionalParam("owner")
    .addPositionalParam("positionId")
    .addPositionalParam("amount0Desired")
    .addPositionalParam("amount1Desired")
    .addPositionalParam("minLiquidity", "slippage", 0, types.int)
    .setAction(async ({owner, positionId, amount0Desired, amount1Desired, minLiquidity},{ethers}) => {
      await advanceBlock();

      const pools = await Pools();
      const positions = await Positions();
      const position = await positions.info(positionId);
      const tokens = await Tokens();
      const users = await Users();

      const user = users.signerFrom(owner);

      const assets = await (await pools.from(position.pool)).getAssets();

      const token0 = await tokens.from(assets[0])
      const token1 = await tokens.from(assets[1])

      const poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;
      if (token0.address == tokens.wklay.address || token1.address == tokens.wklay.address) {
        if (token0.address != tokens.wklay.address) {
          await doExecute(token0.connect(user).approve(poolManager.address, amount0Desired));
          await doExecute(poolManager.connect(user).mintNative(
              position.pool,
              position.lowerTick,
              position.lowerTick,
              position.upperTick,
              position.upperTick,
              amount0Desired,
              minLiquidity,
              position.positionId,
              {value: amount1Desired}
          ));
        } else {
          await doExecute(token1.connect(user).approve(poolManager.address, amount1Desired));
          await doExecute(poolManager.connect(user).mintNative(
              position.pool,
              position.lowerTick,
              position.lowerTick,
              position.upperTick,
              position.upperTick,
              amount1Desired,
              minLiquidity,
              position.positionId,
              {value: amount0Desired}
          ));
        }
      } else {
        await doExecute(token0.connect(user).approve(poolManager.address, amount0Desired));
        await doExecute(token1.connect(user).approve(poolManager.address, amount1Desired));
        await doExecute(poolManager.connect(user).mint(
            position.pool,
            position.lowerTick,
            position.lowerTick,
            position.upperTick,
            position.upperTick,
            amount0Desired,
            amount1Desired,
            minLiquidity,
            position.positionId
        ));
      }

      const table = await positions.positionTable([positionId]);
      console.log(table.toString());
    });

task("position:burn", "remove liquidity from position")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenId")
    .addPositionalParam("amount")
    .addPositionalParam("recipient")
    .addPositionalParam("minimumOut0", "slippage for token0", "0", types.string)
    .addPositionalParam("minimumOut1","slippage for token1", "0", types.string)
    .addPositionalParam("unwrap", "", false, types.boolean)
    .setAction(async (
        {owner, tokenId, amount, recipient, minimumOut0, minimumOut1, unwrap}
    ) => {
      const {ethers} = require('hardhat');

      const users = await Users();
      const positions = await Positions();
      const positionInfo = await positions.info(tokenId);

      const user = users.signerFrom(owner);

      const poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;

      await doExecute(poolManager.connect(user).burn(
          tokenId,
          amount,
          users.addressFrom(recipient),
          minimumOut0,
          minimumOut1,
          unwrap
      ));

      if (await poolManager.exists(tokenId)) {
        const positionInfo = await positions.info(tokenId);
        const table = await positions.positionTable([positionInfo.positionId]);
        console.log(table.toString());
      }

      const balanceTable = await users.balanceTableWith(user.address, [positionInfo.token0, positionInfo.token1]);
      console.log(balanceTable.toString())
    })

task("position:collect", "claim fee from position")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenId")
    .addPositionalParam("recipient")
    .addPositionalParam("unwrap", "", false, types.boolean)
    .setAction(async (
        {owner, tokenId, recipient, unwrap}, {ethers}
    ) => {
      const users = await Users();
      const positions = await Positions();
      const positionInfo = await positions.info(tokenId);

      const user = users.signerFrom(owner);

      const poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;
      await doExecute(poolManager.connect(user).collect(
          tokenId,
          users.addressFrom(recipient),
          unwrap
      ));

      const balanceTable = await users.balanceTableWith(user.address, [positionInfo.token0, positionInfo.token1]);
      console.log(balanceTable.toString())
    })

task("position:collectReward", "claim reward from position")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenId")
    .addPositionalParam("recipient")
    .addPositionalParam("unwrap", "", false, types.boolean)
    .setAction(async (
        {owner, tokenId, recipient, unwrap}, {ethers}
    ) => {
      const users = await Users();
      const positions = await RewardPositions();
      const positionInfo = await positions.info(tokenId);

      const user = users.signerFrom(owner);

      const poolManager = await ethers.getContract("RewardLiquidityPoolManager") as RewardLiquidityPoolManager;
      await doExecute(poolManager.connect(user).collectReward(
          tokenId,
          users.addressFrom(recipient),
          unwrap
      ));

      const rewardToken = await (await ethers.getContractAt<IRewardLiquidityPool>("IRewardLiquidityPool",positionInfo.pool)).rewardToken();
      const balanceTable = await users.balanceTableWith(user.address, [rewardToken]);
      console.log(balanceTable.toString())
    })


task("position:transfer", "transfer position NFT")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("to")
    .addPositionalParam("tokenId")
    .setAction(async (
        {owner, to, tokenId},
        {ethers}
    ) => {
      const users = await Users();
      const positions = await Positions();
      const user = users.signerFrom(owner);

      const poolManager = await ethers.getContract("ConcentratedLiquidityPoolManager") as ConcentratedLiquidityPoolManager;
      await doExecute(poolManager.connect(user).transferFrom(
          user.address,
          users.addressFrom(to),
          tokenId
      ));

      const table = await positions.positionTable([tokenId]);
      console.log(table.toString());
    })


function getTickAtSqrtRatio(priceSqrtRatio:BigNumber) {
  return TickMath.getTickAtSqrtRatio(JSBI.BigInt(priceSqrtRatio));
}

function getNearestUpperValidTick(priceSqrtRatio:BigNumber, tickSpacing: number) {
  const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
  const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
  return (rounded / tickSpacing) % 2 == 0 ? rounded + tickSpacing : rounded;
}

function getNearestLowerValidTick(priceSqrtRatio:BigNumber, tickSpacing: number) {
  const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
  const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
  return (rounded / tickSpacing) % 2 == 0 ? rounded : rounded - tickSpacing;
}
