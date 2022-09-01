import {task} from "hardhat/config";
import {Pools} from "./harness/pools";
import {BigNumber} from "ethers";
import Table from "cli-table3";
import {Tokens} from "./harness/tokens";
import {Positions} from "./harness/positions";
import {RewardPositions} from "./harness/rewardPositions";

task("dashboard:tokens", "Prints the list of tokens on TestPools")
    .setAction(async () => {
      const tokens = await Tokens();
      const tokenInfos = (await Promise.all(
          tokens.all().map(e => tokens.info(e.address))
      )).map(e => [e.name, e.symbol, e.decimals, e.price, e.address])

      const table = new Table({
        head: ["name", "symbol", "decimals", "price($)", "address"]
      })
      table.push(...tokenInfos)

      console.log(table.toString())
    });


task("dashboard:pools", "Prints the list of pools")
    .setAction(async () => {
      const pools = await Pools();
      const poolInfos = await Promise.all((await pools.allPools()).map(e => pools.info(e)));

      const rows = poolInfos.map(e => [
        e.address,
        e.token0.symbol,
        e.token1.symbol,
        e.factory,
        e.swapFee/1000000,
        e.tickSpacing,
        e.price,
        e.reserve0.div(BigNumber.from(10).pow(e.token0.decimals)).toString(),
        e.reserve1.div(BigNumber.from(10).pow(e.token1.decimals)).toString(),
        e.totalValueLock.toString()
      ]);

      const table = new Table({
        head: ["pool Address", "token0", "token1", "factory", "swapFee", "tickSpacing", "priceRatio", 'reserve0', 'reserve1', 'totalValueLock ($)']
      });

      table.push(...rows);

      console.log(table.toString())
    });

task("dashboard:positions", "Prints the list of positions")
    .setAction(async () => {
      const positions = await Positions();
      const allPositions = await positions.all();

      const table = await positions.positionTable(allPositions);
      console.log(table.toString());
    });


task("dashboard:rewardPositions", "Prints the list of positions")
    .setAction(async () => {
      const positions = await RewardPositions();
      const allPositions = await positions.all();

      const table = await positions.positionTable(allPositions);
      console.log(table.toString());
    });
