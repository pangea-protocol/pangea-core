import {task} from "hardhat/config";
import Table from "cli-table3";
import {ConcentratedLiquidityPool__factory, MasterDeployer} from "../types";

task("reserves", "calculate total reserves on PangeaSWAP")
    .setAction(async ({}, {ethers}) => {

      const masterDeployer = await ethers.getContract("MasterDeployer") as MasterDeployer;

      const total = (await masterDeployer.totalPoolsCount()).toNumber();

      const table = new Table({
        head: ["poolAddress", "token0", "token1", 'reserve0', 'reserve1']
      });
      for (let i=0; i < total; i++) {
        const poolAddress = await masterDeployer.getPoolAddress(i);
        const pool = await ConcentratedLiquidityPool__factory.connect(poolAddress, ethers.provider);

        const token0 = await pool.token0()
        const token1 = await pool.token1()
        const reserves = await pool.getReserves()

        table.push([
          poolAddress,
          token0,
          token1,
          reserves._reserve0.toString(),
          reserves._reserve1.toString(),
        ])
      }

      console.log(table.toString());
    })
