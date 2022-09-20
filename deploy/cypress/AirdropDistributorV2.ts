import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {doTransaction, waitConfirmations} from "../utils";
import {MasterDeployer, WETH10} from "../../types";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function ({
                                                         network,
                                                         deployments,
                                                         getNamedAccounts,
                                                         ethers,
                                                       }: HardhatRuntimeEnvironment) {
  if (network.name !== 'cypress') return;

  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();
  const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
  const wklay = await ethers.getContract<WETH10>("WETH10");

  const deployResult = await deploy("AirdropDistributorV2", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, wklay.address]
        }
      }
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000")
  });

  if (await masterDeployer.airdropDistributor() != deployResult.address) {
    await doTransaction(masterDeployer.setAirdropDistributor(deployResult.address));
  }
};

export default deployFunction;

deployFunction.tags = ["cypress-AirdropDistributorV2"];
