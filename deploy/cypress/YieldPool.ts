import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import { doTransaction, waitConfirmations } from "../utils";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
                                                         deployments,
                                                         getNamedAccounts,
                                                         ethers,
                                                         network,
                                                       }: HardhatRuntimeEnvironment) {
  if (network.name !== 'baobab') return;

  const {deploy} = deployments;
  const {deployer, dev} = await getNamedAccounts();
  const masterDeployer = await ethers.getContract("MasterDeployer");
  const poolLogger = await ethers.getContract("PoolLogger");

  // For Test, (stKLAY)
  const yieldToken = "0x675433Ac642EA193A260D82777C2eC22e22482c2";

  const {address: RewardTicks} = await deploy("RewardTicks", {
    from: deployer,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log: true,
    gasPrice: BigNumber.from("250000000000")
  });

  const {address: poolImplementation} = await deploy("YieldPool", {
    from: deployer,
    libraries: {RewardTicks},
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  const deployResult = await deploy("YieldPoolFactory", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [poolImplementation, masterDeployer.address, poolLogger.address, yieldToken]
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
};

export default deployFunction;

deployFunction.tags = ["cypress-YieldPool"];
