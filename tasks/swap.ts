import {task, types} from "hardhat/config";
import {Users} from "./harness/signers";
import {Tokens} from "./harness/tokens";
import {BigNumber} from "ethers";
import {advanceBlock, doExecute} from "./harness/utilites";
import {PoolRouter} from "../types";
const MaxUint256 = BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").toString();

task("swap:exactInputSingle", "ExactInputSingle")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenIn")
    .addPositionalParam("amountIn")
    .addPositionalParam("pool")
    .addPositionalParam("to")
    .addPositionalParam("amountOutMinimum", "", "0", types.string)
    .addPositionalParam("unwrap","",false, types.boolean)
    .setAction(async (
        {owner, tokenIn, amountIn, amountOutMinimum, pool, to, unwrap},
        {ethers}
    ) => {
      await advanceBlock();

      const tokens = await Tokens();
      const users = await Users();

      const user = users.signerFrom(owner);

      console.log("BEFORE SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());
      const poolRouter = await ethers.getContract("PoolRouter") as PoolRouter

      if (tokenIn === 'klay') {
        tokenIn = ethers.constants.AddressZero;

        await doExecute(poolRouter.connect(user).exactInputSingle({
          tokenIn,
          amountIn: BigNumber.from(amountIn),
          amountOutMinimum: BigNumber.from(amountOutMinimum),
          pool,
          to: users.addressFrom(to),
          unwrap
        }, {value: BigNumber.from(amountIn)}));
      } else {
        const token = await tokens.from(tokenIn);
        await doExecute(token.connect(user).approve(poolRouter.address, amountIn));
        tokenIn = token.address

        await doExecute(poolRouter.connect(user).exactInputSingle({
          tokenIn,
          amountIn: BigNumber.from(amountIn),
          amountOutMinimum: BigNumber.from(amountOutMinimum),
          pool,
          to: users.addressFrom(to),
          unwrap
        }));
      }

      console.log("AFTER SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());

    });


task("swap:exactInput", "ExactInput: Multiple hop swap")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenIn")
    .addPositionalParam("amountIn")
    .addPositionalParam("path")
    .addPositionalParam("to")
    .addPositionalParam("amountOutMinimum", "", "0",types.string)
    .addPositionalParam("unwrap","",false, types.boolean)
    .setAction(async (
        {owner, tokenIn, amountIn, amountOutMinimum, path, to, unwrap},
        {ethers}
    ) => {
      await advanceBlock();

      const tokens = await Tokens();
      const users = await Users();

      const user = users.signerFrom(owner);

      console.log("BEFORE SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());

      const poolRouter = await ethers.getContract("PoolRouter") as PoolRouter
      if (tokenIn === 'klay') {
        tokenIn = ethers.constants.AddressZero;

        await doExecute(poolRouter.connect(user).exactInput({
          tokenIn,
          amountIn: BigNumber.from(amountIn),
          amountOutMinimum: BigNumber.from(amountOutMinimum),
          path: JSON.parse(path),
          to: users.addressFrom(to),
          unwrap
        }, {value: BigNumber.from(amountIn)}));
      } else {
        const token = await tokens.from(tokenIn);
        await doExecute(token.connect(user).approve(poolRouter.address, amountIn));
        tokenIn = token.address

        await doExecute(poolRouter.connect(user).exactInput({
          tokenIn,
          amountIn: BigNumber.from(amountIn),
          amountOutMinimum: BigNumber.from(amountOutMinimum),
          path: JSON.parse(path),
          to: users.addressFrom(to),
          unwrap
        }));
      }

      console.log("AFTER SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());
    });


task("swap:exactOutputSingle", "ExactOutputSingle")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenIn")
    .addPositionalParam("amountOut")
    .addPositionalParam("pool")
    .addPositionalParam("to")
    .addPositionalParam("amountInMaximum", "slippage", MaxUint256, types.string)
    .addPositionalParam("unwrap","",false, types.boolean)
    .setAction(async (
        {owner, tokenIn, amountOut, amountInMaximum, pool, to, unwrap},
        {ethers}
    ) => {
      await advanceBlock();

      const tokens = await Tokens();
      const users = await Users();

      const user = users.signerFrom(owner);

      console.log("BEFORE SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());
      const poolRouter = await ethers.getContract("PoolRouter") as PoolRouter;

      if (tokenIn === 'klay') {
        tokenIn = ethers.constants.AddressZero;

        await doExecute(poolRouter.connect(user).exactOutputSingle({
          tokenIn,
          amountOut: BigNumber.from(amountOut),
          amountInMaximum: BigNumber.from(amountInMaximum),
          pool,
          to: users.addressFrom(to),
          unwrap
        }, {value: BigNumber.from(amountInMaximum)}));
      } else {
        const token = await tokens.from(tokenIn);
        await doExecute(token.connect(user).approve(poolRouter.address, amountInMaximum));
        await doExecute(poolRouter.connect(user).exactOutputSingle({
          tokenIn: token.address,
          amountOut: BigNumber.from(amountOut),
          amountInMaximum: BigNumber.from(amountInMaximum),
          pool,
          to: users.addressFrom(to),
          unwrap
        }));
      }
      console.log("AFTER SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());
    });

task("swap:exactOutput", "exactOutput: Multiple hop swap")
    .addPositionalParam("owner", "address or name")
    .addPositionalParam("tokenIn")
    .addPositionalParam("amountOut")
    .addPositionalParam("path")
    .addPositionalParam("to")
    .addPositionalParam("amountInMaximum", "slippage", MaxUint256, types.string)
    .addPositionalParam("unwrap","",false, types.boolean)
    .setAction(async (
        {owner, tokenIn, amountOut, amountInMaximum, path, to, unwrap},
        {ethers}
    ) => {
      await advanceBlock();

      const tokens = await Tokens();
      const users = await Users();

      const user = users.signerFrom(owner);

      console.log("BEFORE SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());

      const poolRouter = await ethers.getContract("PoolRouter") as PoolRouter;
      if (tokenIn === 'klay') {
        tokenIn = ethers.constants.AddressZero;

        await doExecute(poolRouter.connect(user).exactOutput({
          tokenIn,
          amountOut: BigNumber.from(amountOut),
          amountInMaximum: BigNumber.from(amountInMaximum),
          path: JSON.parse(path),
          to: users.addressFrom(to),
          unwrap
        }, {value: BigNumber.from(amountInMaximum)}));
      } else {
        const token = await tokens.from(tokenIn);
        await doExecute(token.connect(user).approve(poolRouter.address, amountInMaximum));
        await doExecute(poolRouter.connect(user).exactOutput({
          tokenIn: token.address,
          amountOut: BigNumber.from(amountOut),
          amountInMaximum: BigNumber.from(amountInMaximum),
          path: JSON.parse(path),
          to: users.addressFrom(to),
          unwrap
        }));
      }

      console.log("AFTER SWAP> user balance");
      console.log((await users.balanceTable(owner)).toString());
    });
