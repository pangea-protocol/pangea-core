import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import {TickIndex} from "../types";

const deployFunction: DeployFunction = async function ({
                                                         deployments,
                                                         getNamedAccounts,
                                                         ethers,
                                                       }: HardhatRuntimeEnvironment) {
  const {deploy} = deployments;
  const {deployer, dev} = await getNamedAccounts();
  const masterDeployer = await ethers.getContract("MasterDeployer");
  const poolLogger = await ethers.getContract("PoolLogger");
  const weth = await ethers.getContract("WETH10");

  const {address: RewardTicks} = await deploy("RewardTicks", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log: true
  });

  const {address: poolImplementation} = await deploy("MiningPool", {
    from: deployer,
    libraries: {RewardTicks},
    log: true,
    waitConfirmations: await waitConfirmations(),
  });

  const deployResult = await deploy("MiningPoolFactory", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [poolImplementation, masterDeployer.address, poolLogger.address]
        }
      }
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
  });

  if (!(await masterDeployer.whitelistedFactories(deployResult.address))) {
    await doTransaction(masterDeployer.addToWhitelistFactory(deployResult.address));
  }

  const tickIndex = await ethers.getContract<TickIndex>("TickIndex");

  await deploy("MiningPoolManager", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, weth.address]
        }
      }
    },
    libraries: {TickIndex: tickIndex.address},
    log: true,
    waitConfirmations: await waitConfirmations(),
  })
};

export default deployFunction;

deployFunction.tags = ["MiningPool"];
