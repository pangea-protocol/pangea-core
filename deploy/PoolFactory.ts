import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import {MasterDeployer, PoolLogger} from "../types";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();

  const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
  const poolLogger = await ethers.getContract<PoolLogger>("PoolLogger");

  const {address: Ticks} = await deploy("Ticks", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log:true,
    gasPrice: BigNumber.from("250000000000")
  });

  const {address: PoolFactoryLib} = await deploy("PoolFactoryLib", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log:true,
    libraries: {Ticks},
    gasPrice: BigNumber.from("250000000000")
  });

  const deployResult  = await deploy("ConcentratedLiquidityPoolFactory", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, poolLogger.address]
        }
      }
    },
    libraries: {
      PoolFactoryLib
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  if (!(await masterDeployer.whitelistedFactories(deployResult.address))) {
    await doTransaction(masterDeployer.addToWhitelistFactory(deployResult.address, {gasPrice: BigNumber.from("250000000000")}));
  }
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer", "PoolLogger"];

deployFunction.tags = ["ConcentratedLiquidityPoolFactory", 'deploy'];
