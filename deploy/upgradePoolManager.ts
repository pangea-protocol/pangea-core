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
  const { deployer, dev } = await getNamedAccounts();
  const masterDeployer = await ethers.getContract("MasterDeployer");
  const weth = await ethers.getContract("WETH10");

  const tickIndex = await ethers.getContract<TickIndex>("TickIndex");
  const TickIndex = tickIndex.address;

  await deploy("ConcentratedLiquidityPoolManager", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, weth.address],
        },
      },
    },
    libraries: { TickIndex },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });

  await deploy("MiningPoolManager", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, weth.address],
        },
      },
    },
    libraries: { TickIndex },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });
};

export default deployFunction;

deployFunction.tags = ["upgradePoolManager"];
