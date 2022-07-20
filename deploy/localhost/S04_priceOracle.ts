import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    ConcentratedLiquidityPoolFactory,
    KETH,
    KUSDT,
    WETH10,
} from "../../types";
import {isLocalTestNetwork, waitConfirmations} from "../utils";

const deployFunction: DeployFunction = async function (
    {
        ethers,
        deployments,
        network
    }: HardhatRuntimeEnvironment) {
    if (! await isLocalTestNetwork()) return;
    console.log("TEST SCENARIO 4 > DEPLOY TEST ORACLE")
    const { deploy } = deployments;
    const { deployer, dev } = await ethers.getNamedSigners();


    const KUSDT = await ethers.getContract<KUSDT>("KUSDT")
    const WKLAY = await ethers.getContract<WETH10>("WETH10")
    const KDAI = await ethers.getContract<KETH>("KDAI")

    const factory = await ethers.getContract<ConcentratedLiquidityPoolFactory>('ConcentratedLiquidityPoolFactory');

    await deploy("PriceOracle", {
        from: deployer.address,
        proxy: {
            owner: dev.address,
            proxyContract: "OpenZeppelinTransparentProxy",
            execute: {
                init: {
                    methodName: "initialize",
                    args: [factory.address, WKLAY.address, [KUSDT.address, KDAI.address]],
                }
            }
        },
        log:true,
        waitConfirmations: await waitConfirmations(),
    });

    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_setIntervalMining", [1000]);
};

export default deployFunction;

deployFunction.dependencies = ["TestAddLiquidity"];

deployFunction.tags = ['TestDeployOracle'];
