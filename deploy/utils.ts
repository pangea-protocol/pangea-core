import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {ContractTransaction} from "ethers";

export async function isLocalTestNetwork() {
    const hre = require("hardhat")
    const chainId = await hre.getChainId();
    return chainId === '31337' || chainId === '203';
}

export async function doTransaction(transaction: Promise<ContractTransaction>) {
    const tx = await transaction;
    const hre = require("hardhat")
    const chainId = await hre.getChainId();
    if (chainId === '31337' || chainId === '203') {
        return;
    }

    const receipt = await tx.wait(await waitConfirmations())
    console.log(`tx : ${receipt.transactionHash} | gasUsed : ${receipt.gasUsed}`)
}

export async function waitConfirmations() {
    return await isLocalTestNetwork() ? 1 : 2;
}

export async function saltValue() {
    const hre = require("hardhat")
    const chainId = await hre.getChainId();
    if (await isLocalTestNetwork()) {
        return '0x7405030400000000000000000000000000000000000000000000000000000000';
    } else if (chainId === '1001') {
        return '0x53a54d024eb9ec98a6f20fda86caebda625411f42cbb7c40fe4426a9d845137c';
    } else {
        return 'NOT DETERMINED';
    }
}

const deployFunction: DeployFunction = async function ({}: HardhatRuntimeEnvironment) {};

export default deployFunction;
