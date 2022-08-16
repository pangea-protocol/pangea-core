import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";
import {MasterDeployer} from "../types";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;

  const { deployer, dev, protocolFeeTo } = await ethers.getNamedSigners();

  await deploy("MasterDeployer", {
    from: deployer.address,
    proxy: {
      owner: dev.address,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [protocolFeeTo.address]
        }
      }
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: "250000000000"
  });
};

export default deployFunction;

deployFunction.tags = ["MasterDeployer", 'deploy'];
