import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";
import {AirdropDistributor, ConcentratedLiquidityPoolManager, MasterDeployer} from "../types";

const deployFunction: DeployFunction = async function ({
                                                           ethers,
                                                           deployments,
                                                           getNamedAccounts,
                                                       }: HardhatRuntimeEnvironment) {
    const { deploy } = deployments;
    const { deployer, dev } = await getNamedAccounts();

    const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
    const airdropDistributor = await ethers.getContract<AirdropDistributor>("AirdropDistributor");
    const positionManager = await ethers.getContract<ConcentratedLiquidityPoolManager>("ConcentratedLiquidityPoolManager");

    await deploy("PoolDashboard", {
        from: deployer,
        proxy: {
          owner: dev,
          proxyContract: "OpenZeppelinTransparentProxy",
          execute: {
            init: {
              methodName: "initialize",
              args: [masterDeployer.address, airdropDistributor.address],
            }
          }
        },
        log:true,
        waitConfirmations: await waitConfirmations(),
    });

  await deploy("PositionDashboard", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [positionManager.address],
        }
      }
    },
    log:true,
    waitConfirmations: await waitConfirmations(),
  });
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer", "AirdropDistributor", "ConcentratedLiquidityPoolManager"];

deployFunction.tags = ["Dashboard", 'deploy'];
