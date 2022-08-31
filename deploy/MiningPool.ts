import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import {MiningPoolManager, PositionDescription, TickIndex} from "../types";
import {BigNumber} from "ethers";

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
    log: true,
    gasPrice: BigNumber.from("250000000000")
  });

  const {address: poolImplementation} = await deploy("MiningPool", {
    from: deployer,
    libraries: {RewardTicks},
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
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
    gasPrice: BigNumber.from("250000000000")
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
    gasPrice: BigNumber.from("250000000000")
  })

  const miningPoolManager = await ethers.getContract("MiningPoolManager") as MiningPoolManager;
  const posDesc = await ethers.getContract("PositionDescription") as PositionDescription;
  await doTransaction(miningPoolManager.setDescriptor(posDesc.address, {gasPrice: BigNumber.from("250000000000") }));
};

export default deployFunction;

deployFunction.tags = ["MiningPool"];
