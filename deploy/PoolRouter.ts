import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();

  const masterDeployer = await ethers.getContract("MasterDeployer");
  const weth = await ethers.getContract("WETH10");

  await deploy("PoolRouter", {
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
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer", "WETH10"];

deployFunction.tags = ["PoolRouter", 'deploy'];
