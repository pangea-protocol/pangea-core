import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";
import {MasterDeployer} from "../types";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;

  const { deployer } = await ethers.getNamedSigners();
  const { dev } = await getNamedAccounts();

  await deploy("ClaimAggregator", {
    from: deployer.address,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: []
        }
      }
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });
};

export default deployFunction;

deployFunction.tags = ["ClaimAggregator", 'deploy'];
