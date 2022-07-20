import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    ConcentratedLiquidityPoolFactory,
    KETH,
    KSP,
    KUSDT,
    MasterDeployer,
    WEMIX,
    KDAI,
    WETH10,
} from "../../types";
import {BigNumber, BigNumberish, utils} from "ethers";
import {encodeSqrtRatioX96} from "@uniswap/v3-sdk";
import {doTransaction, isLocalTestNetwork} from "../utils";

const deployFunction: DeployFunction = async function (
    {
        ethers,
    }: HardhatRuntimeEnvironment) {
    if (! await isLocalTestNetwork()) return;
    console.log("TEST SCENARIO 02 > CREATE POOL")

    const {parseUnits} = ethers.utils;

    const KETH = await ethers.getContract<KETH>("KETH")
    const KUSDT = await ethers.getContract<KUSDT>("KUSDT")
    const WKLAY = await ethers.getContract<WETH10>("WETH10")
    const KDAI = await ethers.getContract<KDAI>("KDAI")
    const WEMIX = await ethers.getContract<WEMIX>("WEMIX")
    const KSP = await ethers.getContract<KSP>("KSP")

    const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
    const factory = await ethers.getContract<ConcentratedLiquidityPoolFactory>("ConcentratedLiquidityPoolFactory");

    /*
     * | pool No | tokenA | tokenB | fee   | amountXDesired | amountYDesired |
     * | 1001    | KETH   | KUSDT  | 0.20% | 2,000          | 5,200,000      |
     * | 1002    | WKLAY  | KDAI   | 0.20% | 200,000        | 216,600        |
     * | 1003    | WKLAY  | KETH   | 0.20% | 200,000        | 84             |
     * | 1004    | WKLAY  | KUSDT  | 0.20% | 200,000        | 217,200        |
     * | 1005    | KUSDT  | KDAI   | 0.06% | 200,000        | 199,280        |
     * | 1006    | WKLAY  | WEMIX  | 0.20% | 200,000        | 50,000         |
     * | 1007    | WKLAY  | KSP    | 0.20% | 200,000        | 40,000         |
     * | 1008    | WKLAY  | STONE  | 0.20% | 100,000        | 50,000         |
     */
    if ((await factory.poolsCount(KETH.address, KUSDT.address)).eq(0)) {
        const data = createDeployData(
            KETH.address, KUSDT.address, 2000, parseUnits("2000", await KETH.decimals()), parseUnits("5200000", await KUSDT.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(WKLAY.address, KDAI.address)).eq(0)) {
        const data = createDeployData(
            WKLAY.address, KDAI.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("216600", await KDAI.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(WKLAY.address, KETH.address)).eq(0)) {
        const data = createDeployData(
            WKLAY.address, KETH.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("84", await KETH.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(WKLAY.address, KUSDT.address)).eq(0)) {
        const data = createDeployData(
            WKLAY.address, KUSDT.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("217200", await KUSDT.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(KUSDT.address, KDAI.address)).eq(0)) {
        const data = createDeployData(
            KUSDT.address, KDAI.address, 600, parseUnits("200000", await KUSDT.decimals()), parseUnits("199280", await KDAI.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(WKLAY.address, WEMIX.address)).eq(0)) {
        const data = createDeployData(
            WKLAY.address, WEMIX.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("50000", await WEMIX.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }

    if ((await factory.poolsCount(WKLAY.address, KSP.address)).eq(0)) {
        const data = createDeployData(
            WKLAY.address, KSP.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("40000", await KSP.decimals())
        )
        await doTransaction(masterDeployer.deployPool(factory.address, data));
    }
};

function priceRatioX96(amount1: BigNumber, amount0:BigNumber): BigNumber {
    return BigNumber.from(encodeSqrtRatioX96(amount1.toString(), amount0.toString()).toString())
}

function encodeData(token0:string, token1:string, fee:BigNumberish, price:BigNumberish, tickSpacing:BigNumberish) {
    return utils.defaultAbiCoder.encode(["address", "address", "uint24", "uint160", "uint24"], [token0, token1, fee, price, tickSpacing]);
}

function createDeployData(token0:string, token1:string, fee:number, token0Amount:BigNumber, token1Amount:BigNumber) {
    if (token0.toLowerCase() > token1.toLowerCase()) {
        [token0, token1] = [token1, token0];
        [token0Amount, token1Amount] = [token1Amount, token0Amount];
    }
    const price = priceRatioX96(token1Amount, token0Amount);
    return encodeData(token0, token1, fee, price, getTickSpacing(fee));
}

export function getTickSpacing(feeAmount: number) {
    const feeUnit = 100; // 0.01%
    return Math.round(feeAmount / feeUnit);
}

export default deployFunction;

deployFunction.dependencies = ["TestMockTokens"];

deployFunction.tags = ['TestCreatePool'];
