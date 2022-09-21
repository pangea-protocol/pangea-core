import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    ConcentratedLiquidityPoolFactory,
    ConcentratedLiquidityPoolManager,
    ConcentratedLiquidityPoolHelper,
    KETH,
    KSP,
    KUSDT,
    WEMIX,
    WETH10,
    ConcentratedLiquidityPool,
    ERC20Test, AirdropDistributor, MasterDeployer, AirdropDistributorV2
} from "../../types";
import {BigNumber} from "@ethersproject/bignumber";
import {TickMath} from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import {sqrt} from "@uniswap/sdk-core";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {BigNumberish} from "ethers";
import {doTransaction, isLocalTestNetwork} from "../utils";

function getTickAtSqrtRatio(priceSqrtRatio:BigNumber) {
    return TickMath.getTickAtSqrtRatio(JSBI.BigInt(priceSqrtRatio));
}

function getNearestUpperValidTick(priceSqrtRatio:BigNumber, tickSpacing: number) {
    const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
    const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
    return (rounded / tickSpacing) % 2 == 0 ? rounded + tickSpacing : rounded;
}

function getNearestLowerValidTick(priceSqrtRatio:BigNumber, tickSpacing: number) {
    const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
    const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
    return (rounded / tickSpacing) % 2 == 0 ? rounded : rounded - tickSpacing;
}

function searchOld(tick:number, ticks:number[]) {
    if (ticks.length == 2) return ticks[0]

    for (const curr of ticks.reverse()) {
        if (curr < tick) {
            return curr
        }
    }

    return ticks[0]
}

const deployFunction: DeployFunction = async function (
    {
        ethers,
    }: HardhatRuntimeEnvironment) {
    if (! await isLocalTestNetwork()) return;
    console.log("TEST SCENARIO 03 > ADD LIQUIDITY")

    const {
        deployer,
        user100,
        user101,
        user103,
        user104,
        user106,
        user107,
    } = await ethers.getNamedSigners();

    const KETH = await ethers.getContract<KETH>("KETH")
    const KUSDT = await ethers.getContract<KUSDT>("KUSDT")
    const WKLAY = await ethers.getContract<WETH10>("WETH10")
    const KDAI = await ethers.getContract<KETH>("KDAI")
    const WEMIX = await ethers.getContract<WEMIX>("WEMIX")
    const KSP = await ethers.getContract<KSP>("KSP")

    const masterDeployer = await ethers.getContract<MasterDeployer>("MasterDeployer");
    const factory = await ethers.getContract<ConcentratedLiquidityPoolFactory>("ConcentratedLiquidityPoolFactory");
    const poolManager = await ethers.getContract<ConcentratedLiquidityPoolManager>("ConcentratedLiquidityPoolManager")
    const poolHelper = await ethers.getContract<ConcentratedLiquidityPoolHelper>("ConcentratedLiquidityPoolHelper")
    const airdropDistributor = await ethers.getContract<AirdropDistributorV2>("AirdropDistributorV2")

    async function getLatestPoolAddress(token0: string, token1: string) {
        const counts = await factory.poolsCount(token0, token1);
        const lst = (await factory.getPools(token0, token1, 0, counts))
        return lst[lst.length - 1]
    }

    const mintAndApprove = async (user:SignerWithAddress, tokenAddress:string, amount:BigNumberish) => {
        if (tokenAddress == WKLAY.address) {
            amount = ethers.utils.parseEther(amount.toString())
            await doTransaction(WKLAY.connect(user).deposit({value:amount}))
            await doTransaction(WKLAY.connect(user).approve(poolManager.address, amount))
        } else {
            const token = await ethers.getContractAt('ERC20Test',tokenAddress) as ERC20Test
            amount = ethers.utils.parseUnits(amount.toString(),await token.decimals())
            await doTransaction(token.connect(user).mint(user.address, amount))
            await doTransaction(token.connect(user).approve(poolManager.address, amount))
        }
    }

    const mintAndAirdrop = async (poolAddress:string, tokenAddress:string, amount:BigNumberish) => {
        if (tokenAddress == WKLAY.address) {
            amount = ethers.utils.parseEther(amount.toString())
            await doTransaction(airdropDistributor.connect(deployer).depositKlay(poolAddress, {value:amount}));
        } else {
            const token = await ethers.getContractAt('ERC20Test',tokenAddress) as ERC20Test
            amount = ethers.utils.parseUnits(amount.toString(),await token.decimals())
            await doTransaction(token.connect(deployer).mint(deployer.address, amount))
            await doTransaction(token.connect(deployer).approve(airdropDistributor.address, amount))
            await doTransaction(airdropDistributor.connect(deployer).depositToken(poolAddress, tokenAddress, amount));
        }
    }

    const addLiquidity = async (user:SignerWithAddress, poolAddress:string, amount0:BigNumberish, amount1:BigNumberish, lower:number, upper:number) => {
        const pool = await ethers.getContractAt<ConcentratedLiquidityPool>('ConcentratedLiquidityPool', poolAddress);
        const assets = await pool.getAssets()
        const tickSpacing = (await pool.getImmutables())._tickSpacing;

        let token0 = await ethers.getContractAt("ERC20Test", assets[0]) as ERC20Test;
        let token1 = await ethers.getContractAt("ERC20Test", assets[1]) as ERC20Test;
        amount0 = ethers.utils.parseUnits(amount0.toString(), await token0.decimals());
        amount1 = ethers.utils.parseUnits(amount1.toString(), await token1.decimals());

        const _price = (await pool.getPriceAndNearestTicks())._price;
        // @ts-ignore
        const _lowerPrice = _price.mul(sqrt(JSBI.BigInt(lower * 10000)).toString()).div(10000)
        // @ts-ignore
        const _upperPrice = _price.mul(sqrt(JSBI.BigInt(upper * 10000)).toString()).div(10000)

        const lowerTick = getNearestLowerValidTick(_lowerPrice, tickSpacing);
        const upperTick = getNearestUpperValidTick(_upperPrice, tickSpacing);

        let _currentTicks = (await poolHelper.getTickState(pool.address)).map(x => x.index);
        const lowerOld = searchOld(lowerTick, _currentTicks);
        _currentTicks.push(lowerTick);
        _currentTicks = _currentTicks.sort((a, b) => a - b);
        const upperOld = searchOld(upperTick, _currentTicks);

        await doTransaction(poolManager.connect(user).mint(
            pool.address,
            lowerOld,
            lowerTick,
            upperOld,
            upperTick,
            amount0,
            amount1,
            ethers.utils.parseEther("0"),
            0
        ));
    }

    const priceRanges = [
        {user:user100, lower:5000,  upper:20000},
        {user:user101, lower:2000,  upper:40000},
        {user:user103, lower:9000,  upper:11000},
        {user:user104, lower:5000,  upper:10000},
        {user:user106, lower:10000, upper:20000},
        {user:user107, lower:5000,  upper:20000},
    ]

    const tokenPairs = [
        {token0:KETH.address,  token1:KUSDT.address, amount0:2000,   amount1: 5200000},
        {token0:WKLAY.address, token1:KDAI.address,  amount0:200000, amount1: 216600},
        {token0:WKLAY.address, token1:KETH.address,  amount0:200000, amount1: 84},
        {token0:WKLAY.address, token1:KUSDT.address, amount0:200000, amount1: 217200},
        {token0:KUSDT.address, token1:KDAI.address,  amount0:200000, amount1: 199280},
        {token0:WKLAY.address, token1:WEMIX.address, amount0:200000, amount1: 50000},
        {token0:WKLAY.address, token1:KSP.address,   amount0:200000, amount1: 40000},
    ]

    for (const pair of tokenPairs) {
        const pool = await getLatestPoolAddress(pair.token0, pair.token1)
        let amount0, amount1;
        if (pair.token0 > pair.token1) {
            [amount0, amount1] = [pair.amount1, pair.amount0]
        } else {
            [amount0, amount1] = [pair.amount0, pair.amount1]
        }

        for (const pr of priceRanges) {
            await mintAndApprove(pr.user, pair.token0, pair.amount0)
            await mintAndApprove(pr.user, pair.token1, pair.amount1)
            await addLiquidity(pr.user, pool, amount0, amount1, pr.lower, pr.upper)
        }
    }

    // first airdrop
    for (const pair of tokenPairs) {
        const pool = await getLatestPoolAddress(pair.token0, pair.token1);

        await mintAndAirdrop(pool, pair.token0, 100);
        await mintAndAirdrop(pool, pair.token1, 100);
    }

    // airdrop all
    const nextEpochStartTime = await airdropDistributor.nextEpochStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextEpochStartTime.add(1).toNumber()]);
    await ethers.provider.send("evm_mine", []);
    await doTransaction(airdropDistributor.airdropAll());

    // second airdrop
    for (const pair of tokenPairs) {
        const pool = await getLatestPoolAddress(pair.token0, pair.token1);

        await mintAndAirdrop(pool, pair.token0, 30);
        await mintAndAirdrop(pool, pair.token1, 30);
    }
};

export default deployFunction;

deployFunction.dependencies = ["TestCreatePool"];

deployFunction.tags = ['TestAddLiquidity'];
