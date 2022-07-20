import {task, types} from "hardhat/config";
import Table from "cli-table3";
import {advanceBlock} from "./harness/utilites";

task("time", "current timestamp")
    .setAction(async ({}) => {
        const {ethers} = require('hardhat');
        await advanceBlock();
        const block = (await ethers.provider.getBlock())

        const table = new Table({});
        table.push(
            {timestamp: block.timestamp},
            {date: (new Date(block.timestamp * 1000)).toUTCString()},
            {blockNumber: block.number}
        );

        console.log(table.toString())
    });

task("time:increase", "incrase timestmap")
    .addPositionalParam("time", "seconds to increase", 0, types.int)
    .setAction(async ({time}) => {
        const {ethers} = require('hardhat');
        await ethers.provider.send("evm_increaseTime", [time]);
        await advanceBlock();

        const block = (await ethers.provider.getBlock())

        const table = new Table({});
        table.push(
            {timestamp: block.timestamp},
            {date: (new Date(block.timestamp * 1000)).toUTCString()},
            {blockNumber:block.number}
        );

        console.log(table.toString())
    });