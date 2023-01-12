import { ethers, network } from "hardhat";
import {
  ERC20Test,
  MasterDeployer,
  MiningPool,
  MiningPoolFactory,
  MiningPoolManager,
  PoolRouter,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../../harness/utils";
import { expect } from "chai";
import { MiningPangea } from "./MiningPangea";
import { TWO_POW_128 } from "../../harness/Concentrated";

describe("Reward Liquidity Pool SCENARIO:AIRDROP", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 0;
  const TICK_SPACING = 40;
  const DAY = 3600 * 24;
  const WEEK = DAY * 7;
  const DUST_VALUE_LIMIT = 10;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdrop: SignerWithAddress;

  let pangea: MiningPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: MiningPoolFactory;
  let poolManager: MiningPoolManager;
  let pool: MiningPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let rewardToken: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdrop] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await MiningPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    rewardToken = (await Token.deploy("REWARD", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableFeeAndTickSpacing(
      SWAP_FEE,
      TICK_SPACING,
      true
    );

    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint24", "uint160", "uint24"],
        [
          token0.address,
          token1.address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );
    await masterDeployer.setAirdropDistributor(airdrop.address);

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    await poolFactory.setRewardToken(poolAddress, rewardToken.address);
    pool = await ethers.getContractAt<MiningPool>("MiningPool", poolAddress);

    await token0.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token0
      .connect(airdrop)
      .approve(poolAddress, ethers.constants.MaxUint256);
    await token1.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token1
      .connect(airdrop)
      .approve(poolAddress, ethers.constants.MaxUint256);

    await rewardToken.mint(
      airdrop.address,
      ethers.constants.MaxUint256.div(10)
    );
    await rewardToken
      .connect(airdrop)
      .approve(poolAddress, ethers.constants.MaxUint256);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  after(async () => {
    await network.provider.send("evm_revert", [_snapshotId]);
    _snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  async function setNextTimeStamp(currentTime: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [currentTime]);
    await ethers.provider.send("evm_mine", []);
  }

  async function clearBalance() {
    await token0.burnAll(trader.address);
    await token1.burnAll(trader.address);
  }

  async function clearLPBalance() {
    await token0.burnAll(liquidityProvider.address);
    await token1.burnAll(liquidityProvider.address);
  }

  async function swapToken0ToToken1(
    amountIn: BigNumber,
    amountOutMinimum: BigNumber
  ) {
    // For test, trader always mint token
    await token0.connect(trader).mint(trader.address, amountIn);
    await token0.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: token0.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  async function swapToken1ToToken0(
    amountIn: BigNumber,
    amountOutMinimum: BigNumber
  ) {
    // For test, trader always mint token
    await token1.connect(trader).mint(trader.address, amountIn);
    await token1.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: token1.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  async function mintNewPosition(
    lowerTick: number,
    upperTick: number,
    multiplier: number
  ) {
    await clearLPBalance();

    const amountDesired = ethers.utils.parseEther("100").mul(multiplier);
    await token0.mint(liquidityProvider.address, amountDesired);
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);

    await token1.mint(liquidityProvider.address, amountDesired);
    await token1
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);
    await poolManager
      .connect(liquidityProvider)
      .mint(
        pool.address,
        lowerTick,
        lowerTick,
        upperTick,
        upperTick,
        amountDesired,
        amountDesired,
        0,
        0
      );

    const count = await poolManager.balanceOf(liquidityProvider.address);
    const positionId = await poolManager.tokenOfOwnerByIndex(
      liquidityProvider.address,
      count.sub(1)
    );
    const liquidity = (await poolManager.positions(positionId)).liquidity;
    return {
      positionId: positionId,
      liquidity: liquidity,
      token0: amountDesired.sub(
        await token0.balanceOf(liquidityProvider.address)
      ),
      token1: amountDesired.sub(
        await token1.balanceOf(liquidityProvider.address)
      ),
    };
  }

  async function addLiquidity(positionId: BigNumber, multiplier: number) {
    const amountDesired = ethers.utils.parseEther("100").mul(multiplier);

    await clearBalance();

    await token0.mint(liquidityProvider.address, amountDesired);
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);

    await token1.mint(liquidityProvider.address, amountDesired);
    await token1
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);

    let position = await poolManager.positions(positionId);
    await poolManager
      .connect(liquidityProvider)
      .mint(
        pool.address,
        position.lower,
        position.lower,
        position.upper,
        position.upper,
        amountDesired,
        amountDesired,
        0,
        positionId
      );

    let newPosition = await poolManager.positions(positionId);
    return {
      positionId: positionId,
      liquidity: newPosition.liquidity.sub(position.liquidity),
      owner: await poolManager.ownerOf(positionId),
      token0: amountDesired.sub(
        await token0.balanceOf(liquidityProvider.address)
      ),
      token1: amountDesired.sub(
        await token1.balanceOf(liquidityProvider.address)
      ),
    };
  }

  describe("# depositRewardAnd", async () => {
    let lp: LPInfo;

    beforeEach("create position", async () => {
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("deposit Reward and depositAirdrop", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      const givenReward = ethers.utils.parseEther("130");

      // WHEN
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // THEN
      expect(await pool.depositedReward()).to.be.eq(0);
      expect(await pool.rewardPerSecond()).to.be.eq(
        BigNumber.from(givenReward).mul(TWO_POW_128).div(WEEK)
      );
    });

    it("deposit Reward and depositAirdrop call (if airdrop amount = 0)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("0");
      const givenAirdrop1 = ethers.utils.parseEther("0");
      const givenReward = ethers.utils.parseEther("130");

      // WHEN
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // THEN
      expect(await pool.depositedReward()).to.be.eq(0);
      expect(await pool.rewardPerSecond()).to.be.eq(
        BigNumber.from(givenReward).mul(TWO_POW_128).div(WEEK)
      );
    });
  });

  describe("# REWARD GROWTH GLOBAL TEST", async () => {
    let lp1: LPInfo;

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     *                                |<------------LP----------->|
     */
    beforeEach("create position", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("TEST 1) distribute Reward But No Liquidity", async () => {
      // GIVEN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          lp1.positionId,
          lp1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("50");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + 10000);

      // THEN
      expect(await pool.rewardPerSecond()).to.be.eq(
        givenReward.mul(TWO_POW_128).div(WEEK)
      );
      expect(await pool.rewardGrowthGlobal()).to.be.eq(BigNumber.from(0));
    });

    it("TEST 2) deposit Reward and time goes on...", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("50");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + 3600);
      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

      // THEN
      const allocatedReward = (await pool.rewardPerSecond()).mul(
        timestamp - givenAirdropStartTime
      );
      expect(await pool.rewardGrowthGlobal()).to.be.eq(
        allocatedReward.div(await pool.liquidity())
      );
    });
  });

  describe("# FEE DISTRIBUTION WITH REWARD (NO SWAP)", async () => {
    let lp1: LPInfo;

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     *                                |<------------LP----------->|
     */
    beforeEach("create position", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("TEST 1) block.timestamp <= airdropStartTime ==> no airdrop", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime - 30);
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      expect(lp1Reward).to.be.eq(BigNumber.from(0));
    });

    it("TEST 2) block.timestamp > airdropStartTime + period ==> all reward is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("100");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );
      expect(givenReward.sub(rewardBalance).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 3) double claim : block.timestamp > airdropStartTime + period ==> all reward is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("100");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );
      expect(givenReward.sub(rewardBalance).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 4) half claim : block.timestamp = airdropStartTime + period/2 ==> half reward is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      const tx = await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);
      const receipt = await tx.wait();
      const timestamp = (await ethers.provider.getBlock(receipt.blockNumber))
        .timestamp;

      // THEN
      const allocatedReward = givenReward
        .mul(timestamp - givenAirdropStartTime)
        .div(WEEK);

      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );

      expect(allocatedReward.sub(rewardBalance).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 5) claim after burn check", async () => {
      // BURN AFTER CLAIM
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await clearLPBalance();
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          lp1.positionId,
          lp1.liquidity.div(2),
          liquidityProvider.address,
          0,
          0,
          false
        );
      await clearLPBalance();
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );

      expect(givenReward.sub(rewardBalance).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 6) claim after mint check", async () => {
      // MINT AFTER CLAIM
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await clearLPBalance();
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await addLiquidity(lp1.positionId, 1);
      await clearLPBalance();
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );
      expect(givenReward.sub(rewardBalance).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 7) burn all liquidity", async () => {
      // MINT AFTER CLAIM
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          lp1.positionId,
          lp1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      // THEN
      const rewardBalance = await rewardToken.balanceOf(
        liquidityProvider.address
      );

      expect(givenReward.sub(rewardBalance).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });
  });

  describe("# FEE DISTRIBUTION WITH AIRDROP & SWAP (NO SWAP FEE)", async () => {
    let lp1: LPInfo;
    let lp2: LPInfo;
    let lp3: LPInfo;

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     *                                |<------------LP1---------->|
     *                |<-------LP2------->|
     *                                                        |<-------LP3------->|
     */
    beforeEach("create position", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      lp2 = await mintNewPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 1);
      lp3 = await mintNewPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("TEST 1) price (0 ---> -2)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("100");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      await poolManager
        .connect(liquidityProvider)
        .collectReward(lp1.positionId, liquidityProvider.address, false);
      const rewardAmount = await rewardToken.balanceOf(
        liquidityProvider.address
      );

      // THEN
      expect(givenReward.sub(rewardAmount).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 2) price (0 ---> -3.5)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("120");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-3.5 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const swapTs = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp2.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const totalLiquidity = lp1.liquidity.add(lp2.liquidity);

      const expectedLp1Reward = givenReward
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenReward
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp2Reward = givenReward
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp2.liquidity)
        .div(totalLiquidity);

      expect(expectedLp1Reward.sub(lp1Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp2Reward.sub(lp2Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 3) price (0 ---> -5)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("120");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-5 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const swapTs = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp2.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const expectedLp1Fee0 = givenReward
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp2Fee0 = givenReward
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);

      expect(expectedLp1Fee0.sub(lp1Reward).abs()).to.be.lte(DUST_VALUE_LIMIT);
      expect(expectedLp2Fee0.sub(lp2Reward).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 4) price (0 ---> 1)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("120");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(1 * TICK_SPACING);
      const inputAmount = await getDy(
        lp1.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      expect(givenReward.sub(lp1Reward).abs()).to.be.lte(DUST_VALUE_LIMIT);
    });

    it("TEST 5) price (0 ---> 3)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("120");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);
      const inputAmount = await getDy(
        lp1.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const swapTs = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );
      const lp3Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp3.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const totalLiquidity = lp1.liquidity.add(lp3.liquidity);

      const expectedLp1Reward = givenReward
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenReward
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp3Reward = givenReward
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp3.liquidity)
        .div(totalLiquidity);

      expect(expectedLp1Reward.sub(lp1Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Reward.sub(lp3Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 6) price (0 ---> 6)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("120");

      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(6 * TICK_SPACING);
      const inputAmount = await getDy(
        lp1.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const swapTs = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(givenAirdropStartTime + WEEK);

      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp1.positionId,
          liquidityProvider.address,
          false
        );
      const lp3Reward = await poolManager
        .connect(liquidityProvider)
        .callStatic.collectReward(
          lp3.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;

      const expectedLp1Reward = givenReward
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp3Reward = givenReward
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);

      expect(expectedLp1Reward.sub(lp1Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Reward.sub(lp3Reward).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });
  });
});

interface LPInfo {
  positionId: BigNumber;
  liquidity: BigNumber;
  token0: BigNumber;
  token1: BigNumber;
}
