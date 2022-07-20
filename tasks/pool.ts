import {task, types} from "hardhat/config";
import {Users} from "./harness/signers";
import {Tokens} from "./harness/tokens";
import {Pools} from "./harness/pools";
import Table from "cli-table3";
import {BigNumber} from "@ethersproject/bignumber";
import {Positions} from "./harness/positions";
import {advanceBlock, doExecute} from "./harness/utilites";
import {
  AirdropDistributor,
  ConcentratedLiquidityPoolFactory,
  MasterDeployer
} from "../types";

task("pool:info", "current status of pool")
    .addPositionalParam("pool")
    .setAction(async ({pool}) => {
      await advanceBlock();

      const pools = await Pools();
      const info = await pools.info(pool)

      const table = new Table({
        head: ["pool Address", "token0", "token1", "swapFee", "priceRatio", 'reserve0', 'reserve1', 'totalValueLock ($)']
      });

      table.push([
        info.address,
        info.token0.symbol,
        info.token1.symbol,
        info.swapFee/1000000,
        info.price,
        info.reserve0.toString(),
        info.reserve1.toString(),
        info.totalValueLock.toString()
      ])
      console.log(table.toString());
    })

task("pool:positions", "current status of position")
    .addPositionalParam("owner")
    .setAction(async ({owner}) => {
      await advanceBlock();

      const users = await Users();
      const positions = await Positions();
      const allPositions = await positions.allOf(users.addressFrom(owner));

      const table = await positions.positionTable(allPositions);
      console.log(table.toString());
    })

task("pool:collectProtocolFee", "collect protocol fee from pool")
    .addPositionalParam("pool")
    .setAction(async ({pool}) => {
      await advanceBlock();

      const pools = await Pools();
      const poolContract = await pools.from(pool);
      const users = await Users();

      const dao = users.signerFrom('protocolFeeTo');

      await doExecute(poolContract.collectProtocolFee());
      console.log((await users.balanceTable(dao.address)).toString());
    })

task("pool:create", "create new pool")
    .addPositionalParam('owner')
    .addPositionalParam("token0")
    .addPositionalParam("token1")
    .addPositionalParam("swapFee")
    .addPositionalParam("amount0" )
    .addPositionalParam("amount1")
    .addPositionalParam("tickSpacing", "", 10,types.int)
    .setAction(async ({owner, token0, token1, swapFee, amount0, amount1, tickSpacing}) => {
      const {ethers} = require('hardhat');
      await advanceBlock();

      const users = await Users();
      const tokens = await Tokens();
      const user = users.signerFrom(owner);
      const token0Contract = await tokens.from(token0);
      const token1Contract = await tokens.from(token1);
      let givenAmount0 = BigNumber.from(amount0).mul(BigNumber.from(10).pow(await token0Contract.decimals()))
      let givenAmount1 = BigNumber.from(amount1).mul(BigNumber.from(10).pow(await token1Contract.decimals()))

      let token0Address;
      let token1Address;
      if (token0Contract.address < token1Contract.address) {
        [token0Address, token1Address] = [token0Contract.address, token1Contract.address];
      } else {
        [token1Address, token0Address] = [token0Contract.address, token1Contract.address];
        [givenAmount1, givenAmount0] = [givenAmount0, givenAmount1];
      }

      const masterDeployer = await ethers.getContract("MasterDeployer") as MasterDeployer;
      const poolFactory = await ethers.getContract("ConcentratedLiquidityPoolFactory") as ConcentratedLiquidityPoolFactory;

      const price =sqrtValue(BigNumber.from(2).pow(192).mul(givenAmount1).div(givenAmount0));
      await doExecute(
          masterDeployer.connect(user).deployPool(
              poolFactory.address,
              ethers.utils.defaultAbiCoder.encode(
                  ["address", "address", "uint24", "uint160", "uint24"],
                  [token0Address, token1Address, swapFee, price, tickSpacing]
              )));

      const pools = await Pools();
      const poolInfos = await Promise.all((await pools.allPools()).map(e => pools.info(e)));

      const rows = poolInfos.map(e => [
        e.address,
        e.token0.symbol,
        e.token1.symbol,
        e.swapFee/1000000,
        e.tickSpacing,
        e.price,
        e.reserve0.div(BigNumber.from(10).pow(e.token0.decimals)).toString(),
        e.reserve1.div(BigNumber.from(10).pow(e.token1.decimals)).toString(),
        e.totalValueLock.toString()
      ]);

      const table = new Table({
        head: ["pool Address", "token0", "token1", "swapFee", "tickSpacing", "priceRatio", 'reserve0', 'reserve1', 'totalValueLock ($)']
      });

      table.push(...rows);

      console.log(table.toString())
    })

task("pool:airdrop:deposit", "airdrop Token to Pool")
    .addPositionalParam("owner", "address of token owner")
    .addPositionalParam("pool", "address of pangea pool to airdrop")
    .addPositionalParam("token", "address of token to airdrop")
    .addPositionalParam("amount", "amount to airdrop", "1", types.string)
    .setAction(async ({owner, pool, token, amount},{ethers}) => {
      const users = await Users();
      const user = users.signerFrom(owner);
      const tokens = await Tokens();
      const tokenContract = await tokens.from(token)

      const airdropDistributor = await ethers.getContract<AirdropDistributor>("AirdropDistributor");

      if ((await tokenContract.symbol()).toLowerCase() == 'wklay') {
        await doExecute(airdropDistributor.connect(user).depositKlay(
            pool, {value:BigNumber.from(amount)})
        );
      } else {
        await doExecute(
            tokenContract.connect(user).approve(airdropDistributor.address, ethers.constants.MaxUint256)
        );
        await doExecute(airdropDistributor.connect(user).depositToken(
            pool, tokenContract.address, BigNumber.from(amount))
        );
      }

      const info = await airdropDistributor.depositedAirdrop(pool);
      const timestamp = info.startTime.toNumber();
      const table = new Table({});
      table.push(
          {epochStartTime: timestamp},
          {date: (new Date(timestamp * 1000)).toUTCString()},
          {token0Amount: info.amount0.toString()},
          {token1Amount: info.amount1.toString()},
      )
      console.log("Airdrop deposit result")
      console.log(table.toString());
    });

task("pool:airdrop:distribute", "distribute all")
    .setAction(async ({}, {ethers}) => {
      const airdropDistributor = await ethers.getContract<AirdropDistributor>("AirdropDistributor");

      await doExecute(airdropDistributor.airdropAll());
    });

function sqrtValue(value) {
  const {ethers} = require('hardhat');
  const ONE = ethers.BigNumber.from(1);
  const TWO = ethers.BigNumber.from(2);

  let x = ethers.BigNumber.from(value);
  let z = x.add(ONE).div(TWO);
  let y = x;
  while (z.sub(y).isNegative()) {
    y = z;
    z = x.div(z).add(z).div(TWO);
  }
  return y;
}
