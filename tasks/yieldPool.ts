import { task } from "hardhat/config";
import {MasterDeployer, YieldPoolFactory} from "../types";
import {ethers} from "hardhat";
import {BigNumber} from "ethers";
import {doTransaction} from "../deploy/utils";

task("yieldPool:create", "current timestamp")
    .addPositionalParam('token')
    .addPositionalParam('rewardToken')
    .addPositionalParam('swapFee')
    .addPositionalParam('tickSpacing')
    .addPositionalParam('tokenAmount')
    .addPositionalParam('yieldTokenAmount')
    .setAction(async ({token, rewardToken, swapFee, tickSpacing, tokenAmount, yieldTokenAmount}, {ethers}) => {
          const [deployer] = await ethers.getSigners();

          const masterDeployer = await ethers.getContract('MasterDeployer') as MasterDeployer;
          const yieldPoolFactory = await ethers.getContract("YieldPoolFactory") as YieldPoolFactory;

          const yieldToken = await yieldPoolFactory.yieldToken();

          let token0Address;
          let token1Address;
          let price;
          if (token.toLowerCase() < yieldToken.toLowerCase()) {
                token0Address = token;
                token1Address = yieldToken;
                price = calculatePrice(tokenAmount, yieldTokenAmount)
          } else {
                token0Address = yieldToken;
                token1Address = token;
                price = calculatePrice(yieldTokenAmount, tokenAmount)
          }

          await doTransaction(yieldPoolFactory.connect(deployer).setAvailableParameter(
              token0Address,
              token1Address,
              rewardToken,
              swapFee,
              tickSpacing
          ));

          await doTransaction(masterDeployer.connect(deployer).deployPool(
              yieldPoolFactory.address,
              ethers.utils.defaultAbiCoder.encode(
                  ["address", "address", "address", "uint24", "uint160", "uint24"],
                  [token0Address, token1Address, rewardToken, swapFee, price, tickSpacing]
              ))
          );

          console.log("complete");
    });


function calculatePrice(amount0, amount1) {
      return sqrtValue(BigNumber.from(amount1).mul(BigNumber.from(2).pow(192)).div(BigNumber.from(amount0)))
}


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
