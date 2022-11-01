import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {doTransaction, waitConfirmations} from "../utils";
import {
  YieldPoolFactory__factory,
  YieldPoolV2__factory
} from "../../types";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
                                                         network,
                                                         deployments,
                                                         getNamedAccounts,
                                                         ethers,
                                                       }: HardhatRuntimeEnvironment) {
  const {deploy} = deployments;
  const {dev} = await getNamedAccounts();
  const deployer = await ethers.getNamedSigner('deployer');
  const protocolFee = 1000;
  const yieldToken = "0xF80F2b22932fCEC6189b9153aA18662b15CC9C00";

  // [1] Upgrade YieldPoolV2
  const {address: poolImplementation} = await deploy("YieldPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks: "0xaCc9af149D4E4B75304eb865B3120aF152B3652C"
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  // [2] Upgrade YieldPoolFactory
  const {address: YieldPoolFactoryAddress} = await deploy("YieldPoolFactory", {
    from: deployer.address,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [poolImplementation, "0xEB4B1CE03bb947Ce23ABd1403dF7C9B86004178d", "0x002A422533cccEeA9aBF9e56e2A25d72672891bC", yieldToken]
        }
      },
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  // [3] check protocolFee
  const yieldPoolFactory = YieldPoolFactory__factory.connect(YieldPoolFactoryAddress, deployer);
  await doTransaction(
      yieldPoolFactory.setDefaultProtocolFee(protocolFee)
  );
  console.log(`default protocolFee : ${await yieldPoolFactory.defaultProtocolFee()}`);

  // [4] set Pool Implementation
  await doTransaction(
      yieldPoolFactory.setPoolImplementation(poolImplementation)
  );

  // [5] upgrade previous pools
  const pools = [
    '0x664d27A79C56BE62c63129fE0dbA53A4Dd10fF7b',
    '0x8E695CAceD03aF8D22DEadddefbcbb617066eFBf',
  ]

  const calls:string[] = [];
  const functionData = YieldPoolV2__factory.createInterface().encodeFunctionData("setProtocolFee", [protocolFee]);
  for (let i=0; i < pools.length; i++) {
    calls.push(functionData);
  }

  await doTransaction(
      yieldPoolFactory.upgradePoolsAndCall(pools, calls)
  )

  for (const address of pools) {
    const pool = await YieldPoolV2__factory.connect(address, ethers.provider);
    console.log(`${address} : ${await pool.protocolFee()}`);
  }
};

export default deployFunction;

deployFunction.tags = ["cypress-YieldPool-Upgrade"];
