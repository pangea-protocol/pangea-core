import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  await deploy("ConcentratedLiquidityPoolHelper", {
    from: deployer,
    deterministicDeployment: false,
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: "250000000000"
  });
};

export default deployFunction;

deployFunction.tags = ["ConcentratedLiquidityPoolHelper", 'deploy'];
