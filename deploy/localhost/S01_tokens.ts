import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {isLocalTestNetwork, saltValue, waitConfirmations} from "../utils";

const deployFunction: DeployFunction = async function (
    {
        deployments,
        getNamedAccounts,
    }: HardhatRuntimeEnvironment) {
    if (! await isLocalTestNetwork()) return;
    console.log("TEST SCENARIO 01 > DEPLOY MOCK TOKENS")

    const { deterministic } = deployments;
    const { deployer } = await getNamedAccounts();
    await (await deterministic("KDAI", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("KETH", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("KORC", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("KSP", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("KUSDT", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("KWBTC", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()

    await (await deterministic("WEMIX", {
        salt: await saltValue(),
        from: deployer,
        waitConfirmations: await waitConfirmations(),
        log:true
    })).deploy()
};

export default deployFunction;

deployFunction.dependencies = ['deploy'];

deployFunction.tags = ["TestMockTokens"];
