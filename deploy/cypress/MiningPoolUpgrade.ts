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
  const protocolFee = 1000;

  // [1] Upgrade MiningPoolV2
  const {address: poolImplementation} = await deploy("MiningPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks: "0xaCc9af149D4E4B75304eb865B3120aF152B3652C"
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
          args: [poolImplementation, "0xEB4B1CE03bb947Ce23ABd1403dF7C9B86004178d", "0x002A422533cccEeA9aBF9e56e2A25d72672891bC"]
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
      '0x0E9B8c0289006e6f0D7f3c0Ec43f73CA78bBb617',
      '0x382c407d975694F9E2F35f4EC81ce51FeD3cE5BE',
      '0x5B408b436CFE343022f50d1736a9EE1D2794B04d',
      '0x5CE5285Ab8261cb671a4217Ff48A89059497F858',
      '0x7FD37D56307d9020aFCBdE46b4933e942481eE61',
      '0x827eAb5e1d10F4E7A88bAd8aB419b3b8206d571F',
      '0x891dDF81e6F59315a2ba630570a546d5c5c29583',
      '0x8B55c469e65689E541628dd7025B8c2F92e2ad09'
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

deployFunction.tags = ["cypress-MiningPool-Upgrade"];
