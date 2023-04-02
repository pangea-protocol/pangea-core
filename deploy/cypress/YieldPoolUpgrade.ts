import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { doTransaction, waitConfirmations } from "../utils";
import { YieldPoolFactory } from "../../types";
import { BigNumber } from "ethers";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { dev } = await getNamedAccounts();
  const deployer = await ethers.getNamedSigner("deployer");

  // [1] Upgrade YieldPoolV2
  const { address: RewardTicks } = await deploy("RewardTicks", {
    from: deployer.address,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log: true,
    gasPrice: BigNumber.from("250000000000"),
  });

  const { address: poolImplementation } = await deploy("YieldPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks,
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });

  // [2] check protocolFee
  const yieldPoolFactory = (await ethers.getContract(
    "YieldPoolFactory",
    deployer
  )) as YieldPoolFactory;

  // [4] set Pool Implementation
  await doTransaction(
    yieldPoolFactory.setPoolImplementation(poolImplementation)
  );

  // [5] upgrade previous pools
  const pools = [
    "0x664d27A79C56BE62c63129fE0dbA53A4Dd10fF7b",
    "0x8E695CAceD03aF8D22DEadddefbcbb617066eFBf",
  ];

  await doTransaction(yieldPoolFactory.upgradePools(pools));
};

export default deployFunction;

deployFunction.tags = ["cypress-YieldPool-Upgrade"];
