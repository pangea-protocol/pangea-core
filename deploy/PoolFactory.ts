import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import {MasterDeployer, PoolLogger} from "../types";

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
    log:true
  });

  const {address: PoolFactoryLib} = await deploy("PoolFactoryLib", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log:true,
    libraries: {Ticks}
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
  });

  if (!(await masterDeployer.whitelistedFactories(deployResult.address))) {
    await doTransaction(masterDeployer.addToWhitelistFactory(deployResult.address));
  }
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer", "PoolLogger"];

deployFunction.tags = ["ConcentratedLiquidityPoolFactory", 'deploy'];
