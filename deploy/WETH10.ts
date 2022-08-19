import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {isLocalTestNetwork, saltValue, waitConfirmations} from "./utils";
import {BigNumber} from "ethers";

const deployFunction: DeployFunction = async function (
    {
        deployments,
        getNamedAccounts,
    }: HardhatRuntimeEnvironment) {

    if (await isLocalTestNetwork()) {
        const { deterministic } = deployments;
        const { deployer } = await getNamedAccounts();

        await (await deterministic("WETH10", {
            salt: await saltValue(),
            from: deployer,
            waitConfirmations: await waitConfirmations(),
            log:true,
            gasPrice: BigNumber.from("250000000000")
        })).deploy()
    } else {
        const { deploy } = deployments;
        const { deployer } = await getNamedAccounts();

        await deploy("WETH10", {
            from: deployer,
            deterministicDeployment: false,
            waitConfirmations: await waitConfirmations(),
            log:true,
            gasPrice: BigNumber.from("250000000000")
        });
    }
};

export default deployFunction;

deployFunction.tags = ["WETH10", 'deploy'];
