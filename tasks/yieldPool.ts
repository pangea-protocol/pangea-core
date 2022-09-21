import { task } from "hardhat/config";
import {IERC20Metadata__factory, MasterDeployer, MiningPoolFactory, YieldPoolFactory} from "../types";
import {BigNumber} from "ethers";
import {doTransaction} from "../deploy/utils";


task("yieldPool:create", "create custom Pool: yieldPool")
    .addPositionalParam('token')
    .addPositionalParam('rewardToken')
    .addPositionalParam('swapFee')
    .addPositionalParam('tickSpacing')
    .addPositionalParam('tokenAmount')
    .addPositionalParam('yieldTokenAmount')
    .setAction(async (
        {token, rewardToken, swapFee, tickSpacing, tokenAmount, yieldTokenAmount},
        {ethers}) => {
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


task("miningPool:create", "create custom Pool: miningPool")
    .addPositionalParam('token0Address')
    .addPositionalParam('token1Address')
    .addPositionalParam('rewardTokenAddress')
    .addPositionalParam('swapFee')
    .addPositionalParam('tickSpacing')
    .addPositionalParam('tokenAmount')
    .addPositionalParam('yieldTokenAmount')
    .setAction(async (
        {token0Address, token1Address, rewardTokenAddress, swapFee, tickSpacing, tokenAmount, yieldTokenAmount},
        {ethers}) => {
      const [deployer] = await ethers.getSigners();

      const masterDeployer = await ethers.getContract('MasterDeployer') as MasterDeployer;
      const miningPoolFactory = await ethers.getContract("MiningPoolFactory") as MiningPoolFactory;

      const token0 = await IERC20Metadata__factory.connect(token0Address, ethers.provider);
      const token1 = await IERC20Metadata__factory.connect(token1Address, ethers.provider);

      let price;
      if (token0Address.toLowerCase() < token1Address.toLowerCase()) {
        price = calculatePrice(
            ethers.utils.parseUnits(tokenAmount, await token0.decimals()),
            ethers.utils.parseUnits(yieldTokenAmount, await token1.decimals())
        );
      } else {
        [token0Address, token1Address] = [token1Address, token0Address];
        price = calculatePrice(
            ethers.utils.parseUnits(yieldTokenAmount, await token1.decimals()),
            ethers.utils.parseUnits(tokenAmount, await token0.decimals()),
        );
      }

      await doTransaction(miningPoolFactory.connect(deployer).setAvailableParameter(
          token0Address,
          token1Address,
          rewardTokenAddress,
          swapFee,
          tickSpacing
      ));

      await doTransaction(masterDeployer.connect(deployer).deployPool(
          miningPoolFactory.address,
          ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "uint24", "uint160", "uint24"],
              [token0Address, token1Address, rewardTokenAddress, swapFee, price, tickSpacing]
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
