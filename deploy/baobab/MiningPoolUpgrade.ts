import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {doTransaction, waitConfirmations} from "../utils";
import {MiningPoolFactory__factory, MiningPoolV2__factory} from "../../types";
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
  const protocolFee = 2000;

  // [1] Upgrade MiningPoolV2
  const {address: poolImplementation} = await deploy("MiningPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks: "0xfF8E5bDf54D5ab74D2E56CA0E575348A52B95B3d"
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  // [2] Upgrade MiningPoolFactory
  const {address: MiningPoolFactoryAddress} = await deploy("MiningPoolFactory", {
    from: deployer.address,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [poolImplementation, "0x899d8Ff3d3BD16DBE4eFF245BdA27EF96C01044B", "0x6e66D3aDfc2902b9e0A46C80D2803642596cc5F6"]
        }
      },
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  // [3] check protocolFee
  const miningPoolFactory = MiningPoolFactory__factory.connect(MiningPoolFactoryAddress, deployer);
  await doTransaction(
      miningPoolFactory.setDefaultProtocolFee(protocolFee)
  );
  console.log(`default protocolFee : ${await miningPoolFactory.defaultProtocolFee()}`);

  // [4] set Pool Implementation
  await doTransaction(
      miningPoolFactory.setPoolImplementation(poolImplementation)
  );

  // [5] upgrade previous pools
  const pools = [
    '0xc322b656c8A56b64a03004c2E0BC4fcEEB23C06f',
    '0x23303Def910469dddbf9C5e2D11920418eB82edf',
    '0xB1E6dD3624867fE60E6D638f1A7B857bDCC928E0'
  ]

  const calls:string[] = [];
  const functionData = MiningPoolV2__factory.createInterface().encodeFunctionData("setProtocolFee", [protocolFee]);
  for (let i=0; i < pools.length; i++) {
    calls.push(functionData);
  }

  await doTransaction(
      miningPoolFactory.upgradePoolsAndCall(pools, calls)
  )

  for (const address of pools) {
    const pool = await MiningPoolV2__factory.connect(address, ethers.provider);
    console.log(`${address} : ${await pool.protocolFee()}`);
  }
};

export default deployFunction;

deployFunction.tags = ["baobab-MiningPool-Upgrade"];
