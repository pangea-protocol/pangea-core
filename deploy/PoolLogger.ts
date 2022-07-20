import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { waitConfirmations } from "./utils";
import {MasterDeployer, PoolLogger} from "../types";

const deployFunction: DeployFunction = async function ({
                                                           ethers,
                                                           deployments,
                                                       }: HardhatRuntimeEnvironment) {
    const { deploy } = deployments;

    const { deployer, dev } = await ethers.getNamedSigners();

    const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");

    await deploy("PoolLogger", {
        from: deployer.address,
        proxy: {
            owner: dev.address,
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [masterDeployer.address]
                }
            }
        },
        log:true,
        waitConfirmations: await waitConfirmations(),
    });
};

export default deployFunction;

deployFunction.dependencies = ["MasterDeployer"];

deployFunction.tags = ["PoolLogger", 'deploy'];
