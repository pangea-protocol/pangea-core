import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import {MasterDeployer, WETH10} from "../types";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();
  const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
  const wklay = await ethers.getContract<WETH10>("WETH10");

  const deployResult  = await deploy("AirdropDistributor", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, wklay.address]
        }
      }
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: "250000000000"
  });

  await doTransaction(masterDeployer.setAirdropDistributor(deployResult.address, {gasPrice: "250000000000"}));
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer", "WETH10"];

deployFunction.tags = ["AirdropDistributor", 'deploy'];
