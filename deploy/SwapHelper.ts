import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { waitConfirmations } from "./utils";
import { WETH10 } from "../types";
import { BigNumber } from "ethers";

const deployFunction: DeployFunction = async function ({
  ethers,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();

  const weth = await ethers.getContract<WETH10>("WETH10");

  // await deploy("SwapHelper", {
  //   from: deployer,
  //   args: [weth.address],
  //   deterministicDeployment: false,
  //   waitConfirmations: await waitConfirmations(),
  //   log: true,
  //   gasPrice: BigNumber.from("250000000000"),
  // });

  await deploy("SafeSwapHelper", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [weth.address],
        },
      },
    },
    waitConfirmations: await waitConfirmations(),
    log: true,
    gasPrice: BigNumber.from("250000000000"),
  });
};

export default deployFunction;

deployFunction.tags = ["SwapHelper", "deploy"];
