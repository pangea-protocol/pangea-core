import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "./utils";

const deployFunction: DeployFunction = async function ({
                                                           deployments,
                                                           getNamedAccounts,
                                                       }: HardhatRuntimeEnvironment) {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    await deploy("Multicall", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: "250000000000"
    });
};

export default deployFunction;

deployFunction.tags = ["Multicall", 'deploy'];
