import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {doTransaction, waitConfirmations} from "./utils";
import { BigNumber } from "ethers";
import { ConcentratedLiquidityPoolManager } from "../types";
import {ethers} from "hardhat";

const deployFunction: DeployFunction = async function (
    {
        deployments,
        getNamedAccounts,
    }: HardhatRuntimeEnvironment) {
    const { deploy } = deployments;
    const { deployer, dev } = await getNamedAccounts();

    const positionManager = await ethers.getContract<ConcentratedLiquidityPoolManager>("ConcentratedLiquidityPoolManager");

    const {address: BiArrow} = await deploy("BiArrow", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: BigNumber.from("250000000000")
    });

    const {address: Font} = await deploy("Font", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: BigNumber.from("250000000000")
    });

    const {address: Message} = await deploy("Message", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: BigNumber.from("250000000000")
    });

    const {address: OffPosition} = await deploy("OffPosition", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: BigNumber.from("250000000000")
    });

    const {address: OnPosition} = await deploy("OnPosition", {
        from: deployer,
        deterministicDeployment: false,
        waitConfirmations: await waitConfirmations(),
        log:true,
        gasPrice: BigNumber.from("250000000000")
    });

    const deployResult = await deploy("PositionDescription", {
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
        gasPrice: BigNumber.from("250000000000"),
        libraries: {
            BiArrow,
            Font,
            Message,
            OffPosition,
            OnPosition
        }
    });

    if (deployResult.newlyDeployed) {
        await doTransaction(positionManager.setDescriptor(deployResult.address, {gasPrice: BigNumber.from("250000000000") }));
    }
};

export default deployFunction;

// deployFunction.dependencies = ["ConcentratedLiquidityPoolManager"];

deployFunction.tags = ["PositionDescription", "deploy"];
