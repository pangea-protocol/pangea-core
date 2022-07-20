import {task, types} from "hardhat/config";
import {ERC20Test} from "../types";
import {Users} from "./harness/signers";
import {Tokens} from "./harness/tokens";
import {advanceBlock, doExecute} from "./harness/utilites";


task("erc20:balanceOf", "user balance status")
    .addPositionalParam("owner")
    .setAction(async ({owner}, ) => {
      const users = await Users();
      const table = await users.balanceTable(owner);

      console.log(table.toString());
    });

task("erc20:faucet", "(only test env) faucet token")
    .addPositionalParam("token", "token list : KDAI KETH KORC KSP KUSDT KWBTC WEMIX")
    .addPositionalParam('to')
    .addPositionalParam("amount", "", "1", types.string)
    .setAction(async ({token, to, amount}) => {
      const {ethers} = require('hardhat');
      await advanceBlock();

      const users = await Users();

      console.log("DO FACUET ", '\n');
      const tokenContract = await ethers.getContract(token) as ERC20Test;
      await doExecute(tokenContract.mint(users.addressFrom(to), amount));

      console.log("USER BALANCE");
      console.log((await users.balanceTableWith(to, [token])).toString(), '\n');
    });

task("erc20:transfer", "transfer token")
    .addPositionalParam("token")
    .addPositionalParam("from")
    .addPositionalParam("to")
    .addPositionalParam("amount", "", "1", types.string)
    .setAction(async ({token, from, to, amount}) => {
      const users = await Users();
      const tokens = await Tokens();
      const user = users.signerFrom(from);
      const toAddress = users.addressFrom(to);

      console.log("DO TRANSFER ", '\n');

      const tokenContract = await tokens.from(token);
      await doExecute(tokenContract.connect(user).transfer(toAddress, amount))

      console.log("AFTER TRANSFER");
      console.log(`${from} Balance`);
      console.log((await users.balanceTableWith(user.address, token)).toString());
      console.log(`${to} Balance`);
      console.log((await users.balanceTableWith(toAddress, token)).toString(),'\n');

    });

task("erc20:approve", "approve token")
    .addPositionalParam("token")
    .addPositionalParam("from")
    .addPositionalParam("to")
    .addPositionalParam("amount", "", "1", types.string)
    .setAction(async ({token, from, to, amount}, ) => {
      const users = await Users();
      const tokens = await Tokens();
      const user = users.signerFrom(from);
      const toAddress = users.addressFrom(to);

      console.log("DO APPROVE ");
      const tokenContract = await tokens.from(token);
      await doExecute(tokenContract.connect(user).approve(toAddress, amount))

      console.log(`${from} -> ${to} Allowance : ${await tokenContract.allowance(user.address, toAddress)}`)
    });
