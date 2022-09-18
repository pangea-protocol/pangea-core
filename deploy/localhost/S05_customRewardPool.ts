import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {
  AirdropDistributorV2,
  ConcentratedLiquidityPoolHelper,
  ERC20Test,
  KDAI,
  KORC,
  MasterDeployer,
  MiningPool,
  MiningPoolFactory,
  MiningPoolManager,
  PoolLogger,
  TickIndex,
  WETH10,
} from "../../types";
import {doTransaction, isLocalTestNetwork, waitConfirmations} from "../utils";
import {BigNumber, BigNumberish, utils} from "ethers";
import {encodeSqrtRatioX96, TickMath} from "@uniswap/v3-sdk";
import {parseUnits} from "ethers/lib/utils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {sqrt} from "@uniswap/sdk-core";
import JSBI from "jsbi";

const deployFunction: DeployFunction = async function (
    {
      ethers,
      deployments,
      network
    }: HardhatRuntimeEnvironment) {
  if (!await isLocalTestNetwork()) return;
  console.log("DEPLOY FOR CUSTOM POOL : MINING POOL")
  await network.provider.send("evm_setAutomine", [false]);
  await network.provider.send("evm_setIntervalMining", [1]);

  const {deploy} = deployments;
  const {deployer, dev} = await ethers.getNamedSigners();

  const masterDeployer = await ethers.getContract("MasterDeployer");
  const poolLogger = await ethers.getContract("PoolLogger");
  const weth = await ethers.getContract("WETH10");
  const tickIndex = await ethers.getContract<TickIndex>("TickIndex");
  const airdropDistributor = await ethers.getContract<AirdropDistributorV2>("AirdropDistributorV2");

  const {address: RewardTicks} = await deploy("RewardTicks", {
    from: deployer.address,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log: true
  });

  const {address: poolImplementation} = await deploy("MiningPool", {
    from: deployer.address,
    libraries: {RewardTicks},
    log: true,
    waitConfirmations: await waitConfirmations(),
  });

  const deployResult = await deploy("MiningPoolFactory", {
    from: deployer.address,
    proxy: {
      owner: dev.address,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [poolImplementation, masterDeployer.address, poolLogger.address]
        }
      }
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
  });

  if (!(await masterDeployer.whitelistedFactories(deployResult.address))) {
    await doTransaction(masterDeployer.addToWhitelistFactory(deployResult.address));
  }

  await deploy("MiningPoolManager", {
    from: deployer.address,
    proxy: {
      owner: dev.address,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [masterDeployer.address, weth.address]
        }
      }
    },
    log: true,
    libraries: {TickIndex: tickIndex.address},
    waitConfirmations: await waitConfirmations(),
  })

  console.log("CREATE REWARD LIQUIDITY POOL")

  const factory = await ethers.getContract<MiningPoolFactory>("MiningPoolFactory");
  const KDAI = await ethers.getContract<KDAI>("KDAI")
  const WKLAY = await ethers.getContract<WETH10>("WETH10")
  const KORC = await ethers.getContract<KORC>("KORC")

  /*
   * | pool No | tokenA | tokenB | REWARD | fee   | amountXDesired | amountYDesired |
   * | 1001    | KDAI   | KORC   | WKLAY  | 0.20% | 200,000        | 200,000        |
   * | 1002    | WKLAY  | KORC   | KDAI   | 0.20% | 200,000        | 216,600        |
   */
  if ((await factory.poolsCount(KDAI.address, KORC.address)).eq(0)) {
    const [tokens, data] = createDeployData(
        KDAI.address, KORC.address, WKLAY.address, 2000, parseUnits("200000", await KDAI.decimals()), parseUnits("10400000", await KORC.decimals())
    )
    await doTransaction(factory.setAvailableParameter(tokens[0], tokens[1], WKLAY.address, 2000, getTickSpacing(2000)))
    await doTransaction(masterDeployer.deployPool(factory.address, data));
  }

  const poolHelper = await ethers.getContract<ConcentratedLiquidityPoolHelper>("ConcentratedLiquidityPoolHelper")
  const poolManager = await ethers.getContract<MiningPoolManager>("MiningPoolManager")

  if ((await factory.poolsCount(WKLAY.address, KORC.address)).eq(0)) {
    const [tokens, data] = createDeployData(
        WKLAY.address, KORC.address, KDAI.address, 2000, parseUnits("200000", await WKLAY.decimals()), parseUnits("216600", await KORC.decimals())
    )
    await doTransaction(factory.setAvailableParameter(tokens[0], tokens[1], KDAI.address, 2000, getTickSpacing(2000)))
    await doTransaction(masterDeployer.deployPool(factory.address, data));
  }

  console.log("ADD LIQUIDITY TO REWARD LIQUIDITY POOL")

  async function getLatestPoolAddress(token0: string, token1: string) {
    const counts = await factory.poolsCount(token0, token1);
    const lst = (await factory.getPools(token0, token1, 0, counts))
    return lst[lst.length - 1]
  }

  const mintAndApprove = async (user: SignerWithAddress, tokenAddress: string, amount: BigNumberish) => {
    if (tokenAddress == WKLAY.address) {
      amount = ethers.utils.parseEther(amount.toString())
      await doTransaction(WKLAY.connect(user).deposit({value: amount}))
      await doTransaction(WKLAY.connect(user).approve(poolManager.address, amount))
    } else {
      const token = await ethers.getContractAt('ERC20Test', tokenAddress) as ERC20Test
      amount = ethers.utils.parseUnits(amount.toString(), await token.decimals())
      await doTransaction(token.connect(user).mint(user.address, amount))
      await doTransaction(token.connect(user).approve(poolManager.address, amount))
    }
  }

  const addLiquidity = async (user: SignerWithAddress, poolAddress: string, amount0: BigNumberish, amount1: BigNumberish, lower: number, upper: number) => {
    const pool = await ethers.getContractAt<MiningPool>('MiningPool', poolAddress);
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

  const {
    user100,
    user101,
    user103,
    user104,
    user106,
    user107,
  } = await ethers.getNamedSigners();

  const priceRanges = [
    {user: user100, lower: 5000, upper: 20000},
    {user: user101, lower: 2000, upper: 40000},
    {user: user103, lower: 9000, upper: 11000},
    {user: user104, lower: 5000, upper: 10000},
    {user: user106, lower: 10000, upper: 20000},
    {user: user107, lower: 5000, upper: 20000},
  ]

  const tokenPairs = [
    {token0: KDAI.address, token1: KORC.address, amount0: 100000, amount1: 100000},
    {token0: WKLAY.address, token1: KORC.address, amount0: 200000, amount1: 216600},
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

  console.log("REWARD DEPOSIT TO REWARD LIQUIDITY POOL")
  const mintAndAirdrop = async (poolAddress: string, amount: BigNumberish) => {
    const pool = await ethers.getContractAt("MiningPool", poolAddress) as MiningPool;
    const tokenAddress = (await pool.rewardToken())
    if (tokenAddress == WKLAY.address) {
      amount = ethers.utils.parseEther(amount.toString())
      await doTransaction(airdropDistributor.connect(deployer).depositKlay(pool.address, {value:amount}));
    } else {
      const token = await ethers.getContractAt('ERC20Test', tokenAddress) as ERC20Test
      amount = ethers.utils.parseUnits(amount.toString(), await token.decimals())

      await doTransaction(token.connect(deployer).mint(deployer.address, amount))
      await doTransaction(token.connect(deployer).approve(airdropDistributor.address, amount))
      await doTransaction(airdropDistributor.connect(deployer).depositToken(pool.address, token.address, amount));
    }
  }

  // first reward drop
  for (const pair of tokenPairs) {
    const pool = await getLatestPoolAddress(pair.token0, pair.token1);
    await mintAndAirdrop(pool, 100);
  }

  const nextEpochStartTime = await airdropDistributor.nextEpochStartTime();
  await ethers.provider.send("evm_setNextBlockTimestamp", [nextEpochStartTime.add(1).toNumber()]);
  await ethers.provider.send("evm_mine", []);
  await doTransaction(airdropDistributor.airdropAll());

  for (const pair of tokenPairs) {
    const pool = await getLatestPoolAddress(pair.token0, pair.token1);
    // airdrop first
    await doTransaction(airdropDistributor.airdrop(pool));

    // second reward drop
    await mintAndAirdrop(pool, 50);
  }

  await network.provider.send("evm_setAutomine", [true]);
  await network.provider.send("evm_setIntervalMining", [1000]);
};

function priceRatioX96(amount1: BigNumber, amount0: BigNumber): BigNumber {
  return BigNumber.from(encodeSqrtRatioX96(amount1.toString(), amount0.toString()).toString())
}

function encodeData(token0: string, token1: string, rewardToken: string, fee: BigNumberish, price: BigNumberish, tickSpacing: BigNumberish) {
  return utils.defaultAbiCoder.encode(
      ["address", "address", "address", "uint24", "uint160", "uint24"],
      [token0, token1, rewardToken, fee, price, tickSpacing]
  );
}

function createDeployData(token0: string, token1: string, rewardToken: string, fee: number, token0Amount: BigNumber, token1Amount: BigNumber) {
  if (token0.toLowerCase() > token1.toLowerCase()) {
    [token0, token1] = [token1, token0];
    [token0Amount, token1Amount] = [token1Amount, token0Amount];
  }
  const price = priceRatioX96(token1Amount, token0Amount);
  return [[token0, token1], encodeData(token0, token1, rewardToken, fee, price, getTickSpacing(fee))];
}

export function getTickSpacing(feeAmount: number) {
  const feeUnit = 100; // 0.01%
  return Math.round(feeAmount / feeUnit);
}

function getTickAtSqrtRatio(priceSqrtRatio: BigNumber) {
  return TickMath.getTickAtSqrtRatio(JSBI.BigInt(priceSqrtRatio));
}

function getNearestUpperValidTick(priceSqrtRatio: BigNumber, tickSpacing: number) {
  const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
  const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
  return (rounded / tickSpacing) % 2 == 0 ? rounded + tickSpacing : rounded;
}

function getNearestLowerValidTick(priceSqrtRatio: BigNumber, tickSpacing: number) {
  const tickAtPrice = getTickAtSqrtRatio(priceSqrtRatio);
  const rounded = Math.round(tickAtPrice / tickSpacing) * tickSpacing;
  return (rounded / tickSpacing) % 2 == 0 ? rounded : rounded - tickSpacing;
}

function searchOld(tick: number, ticks: number[]) {
  if (ticks.length == 2) return ticks[0]

  for (const curr of ticks.reverse()) {
    if (curr < tick) {
      return curr
    }
  }

  return ticks[0]
}


export default deployFunction;

deployFunction.dependencies = ["TestDeployOracle"];

deployFunction.tags = ['CustomRewardPool'];
