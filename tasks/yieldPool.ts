import { task } from "hardhat/config";
import {IERC20Metadata__factory, MasterDeployer, YieldPoolFactory} from "../types";
import {BigNumber} from "ethers";
import {doTransaction} from "../deploy/utils";

task("yieldPool:whitelist", "delete Pool")
    .setAction(async ({},{ethers})=> {
      const [deployer] = await ethers.getSigners();

      const masterDeployer = await ethers.getContract('MasterDeployer') as MasterDeployer;
      const yieldPoolFactory = await ethers.getContract("YieldPoolFactory") as YieldPoolFactory;

      if ((await masterDeployer.connect(deployer).whitelistedFactories(yieldPoolFactory.address))) {
        await doTransaction(masterDeployer.connect(deployer).removeFromWhitelistFactory(yieldPoolFactory.address));
      }

      console.log(await masterDeployer.connect(deployer).whitelistedFactories(yieldPoolFactory.address));
    })


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
          const tokenContract = await IERC20Metadata__factory.connect(token, ethers.provider);
          const yieldTokenContract = await IERC20Metadata__factory.connect(yieldToken, ethers.provider);

          let token0Address;
          let token1Address;
          let price;
          if (token.toLowerCase() < yieldToken.toLowerCase()) {
                token0Address = token;
                token1Address = yieldToken;
                price = calculatePrice(
                    ethers.utils.parseUnits(tokenAmount, await tokenContract.decimals()),
                    ethers.utils.parseUnits(yieldTokenAmount, await yieldTokenContract.decimals())
                );
          } else {
                token0Address = yieldToken;
                token1Address = token;
                price = calculatePrice(
                    ethers.utils.parseUnits(yieldTokenAmount, await yieldTokenContract.decimals()),
                    ethers.utils.parseUnits(tokenAmount, await tokenContract.decimals()),
                );
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


function calculatePrice(amount0:BigNumber, amount1:BigNumber) {
      return sqrtValue(amount1.mul(BigNumber.from(2).pow(192)).div(amount0))
}


function sqrtValue(value) {
      const ONE = BigNumber.from(1);
      const TWO = BigNumber.from(2);

      let x = BigNumber.from(value);
      let z = x.add(ONE).div(TWO);
      let y = x;
      while (z.sub(y).isNegative()) {
            y = z;
            z = x.div(z).add(z).div(TWO);
      }
      return y;
}
