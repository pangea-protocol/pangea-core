import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { waitConfirmations } from "./utils";
import { BigNumber } from "ethers";
import { TickIndex } from "../types";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const { address } = await deploy("DeadAddressRecovery", {
    from: deployer,
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });
  console.log(address);
};

export default deployFunction;

deployFunction.tags = ["DeadAddressRecovery"];
