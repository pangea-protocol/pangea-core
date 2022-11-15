import { task } from "hardhat/config";
import {
  IConcentratedLiquidityPool__factory,
  IERC20Metadata__factory,
  MasterDeployer,
  MiningPoolFactory,
  YieldPoolFactory
} from "../types";
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
    .addPositionalParam('token0Amount')
    .addPositionalParam('token1Amount')
    .setAction(async (
        {token0Address, token1Address, rewardTokenAddress, swapFee, tickSpacing, token0Amount, token1Amount},
        {ethers}) => {
      const [deployer] = await ethers.getSigners();

      const masterDeployer = await ethers.getContract('MasterDeployer', deployer) as MasterDeployer;
      const miningPoolFactory = await ethers.getContract("MiningPoolFactory", deployer) as MiningPoolFactory;

      const token0 = await IERC20Metadata__factory.connect(token0Address, deployer);
      const token1 = await IERC20Metadata__factory.connect(token1Address, deployer);

      let price;
      if (token0Address.toLowerCase() < token1Address.toLowerCase()) {
        price = calculatePrice(
            ethers.utils.parseUnits(token0Amount, await token0.decimals()),
            ethers.utils.parseUnits(token1Amount, await token1.decimals())
        );
      } else {
        [token0Address, token1Address] = [token1Address, token0Address];
        price = calculatePrice(
            ethers.utils.parseUnits(token1Amount, await token1.decimals()),
            ethers.utils.parseUnits(token0Amount, await token0.decimals()),
        );
      }

      await doTransaction(miningPoolFactory.setAvailableParameter(
          token0Address,
          token1Address,
          rewardTokenAddress,
          swapFee,
          tickSpacing
      ));

      await doTransaction(masterDeployer.deployPool(
          miningPoolFactory.address,
          ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "uint24", "uint160", "uint24"],
              [token0Address, token1Address, rewardTokenAddress, swapFee, price, tickSpacing]
          ))
      );
      const poolAddress = await masterDeployer.getPoolAddress((await masterDeployer.totalPoolsCount()).toNumber() - 1);

      console.log(`poolAddress : ${poolAddress}`)
    });


  task("miningPool:mirror", "create custom Pool: miningPool")
      .addPositionalParam("targetPoolAddress")
    .setAction(async (
        {targetPoolAddress},
        {ethers}) => {
      const [deployer] = await ethers.getSigners();
      const rewardTokenAddress = "0xB49E754228bc716129E63b1a7b0b6cf27299979e"

      const masterDeployer = await ethers.getContract('MasterDeployer', deployer) as MasterDeployer;
      const miningPoolFactory = await ethers.getContract("MiningPoolFactory", deployer) as MiningPoolFactory;

      const targetPool = IConcentratedLiquidityPool__factory.connect(targetPoolAddress, ethers.provider);

      const token0Address = await targetPool.token0();
      const token1Address = await targetPool.token1();
      const price = await targetPool.price();
      const swapFee = await targetPool.swapFee();
      const tickSpacing = swapFee == 2000 ? 20 : 2;

      await doTransaction(miningPoolFactory.setAvailableParameter(
          token0Address,
          token1Address,
          rewardTokenAddress,
          swapFee,
          tickSpacing
      ));

      await doTransaction(masterDeployer.deployPool(
          miningPoolFactory.address,
          ethers.utils.defaultAbiCoder.encode(
              ["address", "address", "address", "uint24", "uint160", "uint24"],
              [token0Address, token1Address, rewardTokenAddress, swapFee, price, tickSpacing]
          ))
      );
      const poolAddress = await masterDeployer.getPoolAddress((await masterDeployer.totalPoolsCount()).toNumber() - 1);

      console.log(`poolAddress : ${poolAddress}`)
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
