import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {waitConfirmations} from "../utils";

const deployFunction: DeployFunction = async function (
    {
        deployments,
        getNamedAccounts,
        network
    }: HardhatRuntimeEnvironment) {
    if (network.name !== 'baobab') return;
    console.log("BAOBAB SCENARIO 01 > DEPLOY MOCK TOKENS")

    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    await deploy("KDAI", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("KETH", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("KORC", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("KSP", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("KUSDT", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("KWBTC", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });

    await deploy("WEMIX", {
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    });
};

export default deployFunction;

deployFunction.dependencies = ['deploy'];

deployFunction.tags = ["mockTokens", 'baobab'];
