import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();
  const masterDeployer = await ethers.getContract("MasterDeployer");
  const weth = await ethers.getContract("WETH10");

  const {address: TickIndex} = await deploy("TickIndex", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log:true
  });

  await deploy("ConcentratedLiquidityPoolManager", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, weth.address],
        }
      }
    },
    libraries: { TickIndex },
    log:true,
    waitConfirmations: await waitConfirmations(),
  });
};

export default deployFunction;

// deployFunction.dependencies = ["MasterDeployer", "WETH10"];

deployFunction.tags = ["ConcentratedLiquidityPoolManager", 'deploy'];
