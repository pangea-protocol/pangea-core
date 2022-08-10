import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  PoolRouter,
  ERC20Test,
  MasterDeployer,
  WETH10,
  SwapHelper,
} from "../../types";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../harness/utils";
import { expect } from "chai";
import { describe } from "mocha";
import { Pangea } from "../harness/pangea";
import { encodeCreatePoolData } from "../harness/helpers";

describe("SCENARIO:EDGE CASE", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_BASE = 1000000;
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 20;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdropManager: SignerWithAddress;

  let pangea: Pangea;
  let wklay: WETH10;
  let masterDeployer: MasterDeployer;
  let poolFactory: ConcentratedLiquidityPoolFactory;
  let poolManager: ConcentratedLiquidityPoolManager;
  let pool: ConcentratedLiquidityPool;
  let nativePool: ConcentratedLiquidityPool;
  let swapHelper: SwapHelper;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdropManager] =
      await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await Pangea.Instance.init();
    wklay = pangea.weth;
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.concentratedPoolFactory;
    poolManager = pangea.concentratedPoolManager;
    router = pangea.router;
    swapHelper = pangea.swapHelper;

    await masterDeployer.setAirdropDistributor(airdropManager.address);

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableFeeAndTickSpacing(
      SWAP_FEE,
      TICK_SPACING,
      true
    );
    await masterDeployer.deployPool(
      poolFactory.address,
      encodeCreatePoolData(token0, token1, SWAP_FEE, TWO_POW_96, TICK_SPACING)
    );

    const [tokenN0, tokenN1] =
      token0.address.toLowerCase() < wklay.address.toLowerCase()
        ? [token0.address, wklay.address]
        : [wklay.address, token0.address];
    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint24", "uint160", "uint24", "address"],
        [
          tokenN0,
          tokenN1,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
          ethers.constants.AddressZero,
        ]
      )
    );

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool",
      poolAddress
    );

    const nativePoolAddress = (
      await poolFactory.getPools(token0.address, wklay.address, 0, 1)
    )[0];
    nativePool = await ethers.getContractAt<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool",
      nativePoolAddress
    );

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

  async function clearBalance() {
    await token0.burnAll(trader.address);
    await token1.burnAll(trader.address);
  }

  async function traderBalance() {
    return {
      token0: await token0.balanceOf(trader.address),
      token1: await token1.balanceOf(trader.address),
    };
  }

  async function swapToken0ToToken1(amountIn: BigNumber) {
    // For test, trader always mint token
    await token0.connect(trader).mint(trader.address, amountIn);
    await token0.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: token0.address,
      amountIn,
      amountOutMinimum: 0,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  async function swapToken1ToToken0(amountIn: BigNumber) {
    // For test, trader always mint token
    await token1.connect(trader).mint(trader.address, amountIn);
    await token1.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: token1.address,
      amountIn,
      amountOutMinimum: 0,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  async function tokenBetween(
    liquidity: BigNumber,
    lowerTick: number,
    upperTick: number
  ) {
    let lower = await getPriceAtTick(lowerTick);
    let upper = await getPriceAtTick(upperTick);
    [lower, upper] = lower.lt(upper) ? [lower, upper] : [upper, lower];
    const token0 = await getDx(liquidity, lower, upper, true);
    const token1 = await getDy(liquidity, lower, upper, true);
    return { token0, token1 };
  }

  async function token1Between(
    liquidity: BigNumber,
    lowerTick: number,
    upperTick: number
  ) {
    let lower = await getPriceAtTick(lowerTick);
    let upper = await getPriceAtTick(upperTick);
    [lower, upper] = lower.lt(upper) ? [lower, upper] : [upper, lower];
    return await getDy(liquidity, lower, upper, true);
  }

  function withInPrecision(
    price0: BigNumber,
    price1: BigNumber,
    precision: number
  ) {
    const base = BigNumber.from(10).pow(precision);
    const value = base.sub(price0.mul(base).div(price1)).abs();
    return value.lte(1);
  }

  async function setNextTimeStamp(currentTime: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [currentTime]);
    await ethers.provider.send("evm_mine", []);
  }

  async function increaseTime(time: number) {
    await ethers.provider.send("evm_increaseTime", [time]);
    await ethers.provider.send("evm_mine", []);
  }

  async function addLiquidity(lowerTick: number, upperTick: number) {
    const amount0Desired = ethers.utils.parseEther("100");
    await token0.mint(liquidityProvider.address, amount0Desired.mul(4));
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amount0Desired.mul(4));

    const amount1Desired = ethers.utils.parseEther("100");
    await token1.mint(liquidityProvider.address, amount1Desired.mul(4));
    await token1
      .connect(liquidityProvider)
      .approve(poolManager.address, amount1Desired.mul(4));
    await poolManager
      .connect(liquidityProvider)
      .mint(
        pool.address,
        lowerTick,
        lowerTick,
        upperTick,
        upperTick,
        amount0Desired,
        amount1Desired,
        0,
        0
      );
  }

  async function addLiquidityNative(lowerTick: number, upperTick: number) {
    const amountDesired = ethers.utils.parseEther("100");
    await token0.mint(liquidityProvider.address, amountDesired);
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);

    await poolManager
      .connect(liquidityProvider)
      .mintNative(
        nativePool.address,
        lowerTick,
        lowerTick,
        upperTick,
        upperTick,
        amountDesired,
        0,
        0,
        { value: amountDesired }
      );
  }

  async function burn(positionId: BigNumberish, liquidity: BigNumberish) {
    const result = await poolManager
      .connect(liquidityProvider)
      .callStatic.burn(
        positionId,
        liquidity,
        liquidityProvider.address,
        0,
        0,
        false
      );

    await poolManager
      .connect(liquidityProvider)
      .burn(positionId, liquidity, liquidityProvider.address, 0, 0, false);
    return result;
  }

  async function burnAll(positionId: BigNumberish) {
    const result = await poolManager
      .connect(liquidityProvider)
      .callStatic.burn(
        positionId,
        (
          await poolManager.positions(positionId)
        ).liquidity,
        liquidityProvider.address,
        0,
        0,
        false
      );

    await poolManager
      .connect(liquidityProvider)
      .burn(
        positionId,
        (
          await poolManager.positions(positionId)
        ).liquidity,
        liquidityProvider.address,
        0,
        0,
        false
      );
    return result;
  }

  async function collectFees(positionId: BigNumberish) {
    const result = await poolManager
      .connect(liquidityProvider)
      .callStatic.collect(positionId, liquidityProvider.address, false);

    await poolManager
      .connect(liquidityProvider)
      .collect(positionId, liquidityProvider.address, false);
    return result;
  }

  /*
   * When liquidity is burned all for the current price, is the swap performed normally?
   *
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *                        |-----------|   |-----------|   |-----------|
   */
  describe("# BURN ALL LIQUIDITY CASE ", async () => {
    let lp1: BigNumber;
    let lp2: BigNumber;
    let lp3: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-6 * TICK_SPACING, -3 * TICK_SPACING);
      await addLiquidity(-2 * TICK_SPACING, TICK_SPACING);
      await addLiquidity(2 * TICK_SPACING, 5 * TICK_SPACING);
      lp1 = (await poolManager.positions(1)).liquidity;
      lp2 = (await poolManager.positions(2)).liquidity;
      lp3 = (await poolManager.positions(3)).liquidity;
    });

    it("TEST 1) swap direction : price down", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // SECOND, TRY TO SWAP
      const currentPrice = await getPriceAtTick(-3 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);
      const inputAmount = await getDx(lp1, targetPrice, currentPrice, true);
      await clearBalance();
      await swapToken0ToToken1(inputAmount);

      const result = (await traderBalance()).token1;
      const expectedOutput = (await getDy(lp1, targetPrice, currentPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = (
        await getDy(lp1, targetPrice, currentPrice, true)
      )
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const feeResult1 = await collectFees(1);
      const feeResult3 = await collectFees(3);
      expect(feeResult1.token0amount).to.be.eq(0);
      expect(withInPrecision(feeResult1.token1amount, expectedSwapFee, 8)).to.be
        .true;

      expect(feeResult3.token0amount).to.be.eq(0);
      expect(feeResult3.token1amount).to.be.eq(0);

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 2) swap direction : price up", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // SECOND, TRY TO SWAP
      const currentPrice = await getPriceAtTick(2 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);
      const inputAmount = await getDy(lp3, currentPrice, targetPrice, true);
      await clearBalance();
      await swapToken1ToToken0(inputAmount);

      const result = (await traderBalance()).token0;
      const expectedOutput = (await getDx(lp3, currentPrice, targetPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = (
        await getDx(lp3, currentPrice, targetPrice, true)
      )
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const feeResult1 = await collectFees(1);
      const feeResult3 = await collectFees(3);
      expect(feeResult1.token0amount).to.be.eq(0);
      expect(feeResult1.token1amount).to.be.eq(0);

      expect(withInPrecision(feeResult3.token0amount, expectedSwapFee, 8)).to.be
        .true;
      expect(feeResult3.token1amount).to.be.eq(0);

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 3) swap direction : price down and Up", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // SECOND, TRY TO SWAP FROM token0 to token1
      {
        const currentPrice = await getPriceAtTick(-3 * TICK_SPACING);
        const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);
        const inputAmount = await getDx(lp1, targetPrice, currentPrice, true);
        await swapToken0ToToken1(inputAmount);
      }

      // THIRD, TRY TO SWAP FROM token1 to token0
      {
        const span0Input = await getDy(
          lp1,
          await getPriceAtTick(-4 * TICK_SPACING),
          await getPriceAtTick(-3 * TICK_SPACING),
          true
        );
        const span1Input = await getDy(
          lp3,
          await getPriceAtTick(2 * TICK_SPACING),
          await getPriceAtTick(3 * TICK_SPACING),
          true
        );
        const span0Output = await getDx(
          lp1,
          await getPriceAtTick(-4 * TICK_SPACING),
          await getPriceAtTick(-3 * TICK_SPACING),
          true
        );
        const span1Output = await getDx(
          lp3,
          await getPriceAtTick(2 * TICK_SPACING),
          await getPriceAtTick(3 * TICK_SPACING),
          true
        );
        const spanInput = span0Input.add(span1Input);
        const spanOutput = span0Output.add(span1Output);

        await clearBalance();
        await swapToken1ToToken0(spanInput);

        const result = (await traderBalance()).token0;
        const expectedOutput = spanOutput
          .mul(SWAP_BASE - SWAP_FEE)
          .div(SWAP_BASE);
        const poolPrice = await pool.price();

        // TEST SWAP RESULT
        expect(
          withInPrecision(await getPriceAtTick(3 * TICK_SPACING), poolPrice, 8)
        ).to.be.true;
        expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

        const feeResult1 = await collectFees(1);
        const feeResult3 = await collectFees(3);
        expect(
          withInPrecision(
            feeResult1.token0amount,
            span0Output.mul(Math.floor(SWAP_FEE * 0.9)).div(SWAP_BASE),
            8
          )
        ).to.be.true;
        expect(
          withInPrecision(
            feeResult3.token0amount,
            span1Output.mul(Math.floor(SWAP_FEE * 0.9)).div(SWAP_BASE),
            8
          )
        ).to.be.true;
      }

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 4) swap direction : price up and down", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // SECOND, TRY TO SWAP
      {
        const spanInput = await token1Between(
          lp3,
          2 * TICK_SPACING,
          3 * TICK_SPACING
        );
        await clearBalance();
        await swapToken1ToToken0(spanInput);
      }

      {
        const { token0: span0Token0, token1: span0Token1 } = await tokenBetween(
          lp3,
          2 * TICK_SPACING,
          3 * TICK_SPACING
        );
        const { token0: span1Token0, token1: span1Token1 } = await tokenBetween(
          lp1,
          -4 * TICK_SPACING,
          -3 * TICK_SPACING
        );
        const spanInput = span0Token0.add(span1Token0);
        const spanOutput = span0Token1.add(span1Token1);

        await clearBalance();
        await swapToken0ToToken1(spanInput);

        const result = (await traderBalance()).token1;
        const expectedOutput = spanOutput
          .mul(SWAP_BASE - SWAP_FEE)
          .div(SWAP_BASE);
        const poolPrice = await pool.price();

        expect(
          withInPrecision(await getPriceAtTick(-4 * TICK_SPACING), poolPrice, 8)
        ).to.be.true;
        expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

        const feeResult1 = await collectFees(1);
        const feeResult3 = await collectFees(3);
        expect(
          withInPrecision(
            feeResult1.token1amount,
            span1Token1.mul(Math.floor(SWAP_FEE * 0.9)).div(SWAP_BASE),
            8
          )
        ).to.be.true;
        expect(
          withInPrecision(
            feeResult3.token1amount,
            span0Token1.mul(Math.floor(SWAP_FEE * 0.9)).div(SWAP_BASE),
            8
          )
        ).to.be.true;
      }

      await burnAll(1);
      await burnAll(3);
    });
  });

  /*
   * After pool is run out of liquidity, is additional liquidity mint & burn normally performed?
   *
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *                                |---------------------------|
   */
  describe("# RUN OUT OF LIQUIDITY CASE ", async () => {
    let lp: BigNumber;
    beforeEach("deploy Pool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      lp = (await poolManager.positions(1)).liquidity;
    });

    it("TEST 1) swap direction : price up", async () => {
      const { token0, token1 } = await tokenBetween(lp, 0, 3 * TICK_SPACING);
      await swapToken1ToToken0(token1.add(ethers.utils.parseEther("100")));

      const poolPrice = await pool.price();
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);
      const poolLiquidity = await pool.liquidity();
      expect(poolPrice).to.be.eq(targetPrice.add(1));
      expect(poolLiquidity).to.be.eq(0);

      await addLiquidity(-1 * TICK_SPACING, 3 * TICK_SPACING);

      await burnAll(2);
    });

    it("TEST 2) swap direction : price down", async () => {
      const { token0, token1 } = await tokenBetween(lp, -4 * TICK_SPACING, 0);
      await swapToken0ToToken1(token0.add(ethers.utils.parseEther("100")));

      const poolPrice = await pool.price();
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);
      const poolLiquidity = await pool.liquidity();
      expect(poolPrice).to.be.eq(targetPrice.sub(1));
      expect(poolLiquidity).to.be.eq(0);

      await addLiquidity(-5 * TICK_SPACING, 3 * TICK_SPACING);

      await burnAll(2);
    });
  });

  describe("# BURN ALL LIQUIDITY CASE WITH AIRDROP", async () => {
    let lp1: BigNumber;
    let lp2: BigNumber;
    let lp3: BigNumber;

    let startTime;
    let period;
    let airdrop0 = ethers.utils.parseEther("100");
    let airdrop1 = ethers.utils.parseEther("200");

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-6 * TICK_SPACING, -3 * TICK_SPACING);
      await addLiquidity(-2 * TICK_SPACING, TICK_SPACING);
      await addLiquidity(2 * TICK_SPACING, 5 * TICK_SPACING);
      lp1 = (await poolManager.positions(1)).liquidity;
      lp2 = (await poolManager.positions(2)).liquidity;
      lp3 = (await poolManager.positions(3)).liquidity;

      startTime = (await ethers.provider.getBlock("latest")).timestamp + 10;
      period = 604_800;
      await token0
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop0.mul(10));
      await token1
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop1.mul(10));
      await token0
        .connect(airdropManager)
        .approve(pool.address, airdrop0.mul(10));
      await token1
        .connect(airdropManager)
        .approve(pool.address, airdrop1.mul(10));

      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);
    });

    it("TEST 1) swap direction : price down", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // TIME GOES ON
      await setNextTimeStamp(startTime + period / 2);

      // SECOND, TRY TO SWAP
      const { token0: span0Token0, token1: span0Token1 } = await tokenBetween(
        lp1,
        -3 * TICK_SPACING,
        -4 * TICK_SPACING
      );

      await clearBalance();
      await swapToken0ToToken1(span0Token0);

      const result = (await traderBalance()).token1;
      const expectedOutput = span0Token1
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = span0Token1
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(
        withInPrecision(await getPriceAtTick(-4 * TICK_SPACING), poolPrice, 8)
      ).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const feeResult1 = await collectFees(1);

      const feeResult3 = await collectFees(3);
      let airdropFee0 = airdrop0.mul(timestamp - startTime).div(period);
      let airdropFee1 = airdrop1.mul(timestamp - startTime).div(period);

      expect(feeResult1.token0amount).to.be.eq(airdropFee0);
      expect(
        withInPrecision(
          feeResult1.token1amount,
          expectedSwapFee.add(airdropFee1),
          8
        )
      ).to.be.true;
      expect(feeResult3.token0amount).to.be.eq(0);
      expect(feeResult3.token1amount).to.be.eq(0);

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 2) swap direction : price up", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);

      // TIME GOES ON
      await setNextTimeStamp(startTime + period / 2);

      // SECOND, TRY TO SWAP
      const { token0: span0Token0, token1: span0Token1 } = await tokenBetween(
        lp3,
        2 * TICK_SPACING,
        3 * TICK_SPACING
      );

      await clearBalance();
      await swapToken1ToToken0(span0Token1);

      const result = (await traderBalance()).token0;
      const expectedOutput = span0Token0
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = span0Token0
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(
        withInPrecision(await getPriceAtTick(3 * TICK_SPACING), poolPrice, 8)
      ).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const feeResult3 = await collectFees(3);
      const feeResult1 = await collectFees(1);
      let airdropFee0 = airdrop0.mul(timestamp - startTime).div(period);
      let airdropFee1 = airdrop1.mul(timestamp - startTime).div(period);

      expect(feeResult1.token0amount).to.be.eq(0);
      expect(feeResult1.token1amount).to.be.eq(0);
      expect(
        withInPrecision(
          feeResult3.token0amount,
          expectedSwapFee.add(airdropFee0),
          8
        )
      ).to.be.true;
      expect(feeResult3.token1amount).to.be.eq(airdropFee1);

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 3) re-distribution after airdrop (price down)", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);
      await setNextTimeStamp(startTime + period);
      startTime = startTime + period + 10;
      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);

      // TIME GOES ON
      await setNextTimeStamp(startTime + period / 2);

      // SECOND, TRY TO SWAP
      const { token0: span0Token0, token1: span0Token1 } = await tokenBetween(
        lp3,
        2 * TICK_SPACING,
        3 * TICK_SPACING
      );

      await clearBalance();
      await swapToken1ToToken0(span0Token1);

      const result = (await traderBalance()).token0;
      const expectedOutput = span0Token0
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = span0Token0
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(
        withInPrecision(await getPriceAtTick(3 * TICK_SPACING), poolPrice, 8)
      ).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const feeResult3 = await collectFees(3);
      const feeResult1 = await collectFees(1);
      let airdropFee0 = airdrop0
        .mul(2)
        .mul(timestamp - startTime)
        .div(period);
      let airdropFee1 = airdrop1
        .mul(2)
        .mul(timestamp - startTime)
        .div(period);

      expect(feeResult1.token0amount).to.be.eq(0);
      expect(feeResult1.token1amount).to.be.eq(0);
      expect(
        withInPrecision(
          feeResult3.token0amount,
          expectedSwapFee.add(airdropFee0),
          8
        )
      ).to.be.true;
      expect(feeResult3.token1amount).to.be.eq(airdropFee1);

      await burnAll(1);
      await burnAll(3);
    });

    it("TEST 4) re-distribution after airdrop (price up)", async () => {
      // FIRST, BURN LIQUIDITY LP2
      await burnAll(2);
      await setNextTimeStamp(startTime + period);
      startTime = startTime + period + 10;
      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);

      // TIME GOES ON
      await setNextTimeStamp(startTime + period / 2);

      // SECOND, TRY TO SWAP
      const { token0: span0Token0, token1: span0Token1 } = await tokenBetween(
        lp1,
        -4 * TICK_SPACING,
        -3 * TICK_SPACING
      );

      await clearBalance();
      await swapToken0ToToken1(span0Token0);

      const result = (await traderBalance()).token1;
      const expectedOutput = span0Token1
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const expectedSwapFee = span0Token1
        .mul(Math.floor(SWAP_FEE * 0.9))
        .div(SWAP_BASE);
      const poolPrice = await pool.price();

      // TEST SWAP RESULT
      expect(
        withInPrecision(await getPriceAtTick(-4 * TICK_SPACING), poolPrice, 8)
      ).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;

      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
      const feeResult1 = await collectFees(1);
      const feeResult3 = await collectFees(3);
      let airdropFee0 = airdrop0
        .mul(2)
        .mul(timestamp - startTime)
        .div(period);
      let airdropFee1 = airdrop1
        .mul(2)
        .mul(timestamp - startTime)
        .div(period);

      expect(feeResult1.token0amount.sub(airdropFee0).abs()).to.be.lte(10);
      expect(
        withInPrecision(
          feeResult1.token1amount,
          expectedSwapFee.add(airdropFee1),
          8
        )
      ).to.be.true;
      expect(feeResult3.token0amount).to.be.eq(0);
      expect(feeResult3.token1amount).to.be.eq(0);

      await burnAll(1);
      await burnAll(3);
    });
  });

  /*
   */
  describe("# RUN OUT OF LIQUIDITY CASE WITH AIRDROP", async () => {
    let lp: BigNumber;
    let startTime;
    let period;
    let airdrop0 = ethers.utils.parseEther("100");
    let airdrop1 = ethers.utils.parseEther("200");

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      lp = (await poolManager.positions(1)).liquidity;

      startTime = (await ethers.provider.getBlock("latest")).timestamp + 10;
      period = 604_800;
      await token0
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop0.mul(10));
      await token1
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop1.mul(10));
      await token0
        .connect(airdropManager)
        .approve(pool.address, airdrop0.mul(10));
      await token1
        .connect(airdropManager)
        .approve(pool.address, airdrop1.mul(10));

      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);
    });

    it("TEST 1) swap direction : price up", async () => {
      const { token0, token1 } = await tokenBetween(lp, 0, 3 * TICK_SPACING);

      await swapToken1ToToken0(token1.add(ethers.utils.parseEther("100")));
      await setNextTimeStamp(startTime + period / 2);

      const poolPrice = await pool.price();
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);
      const poolLiquidity = await pool.liquidity();
      expect(poolPrice).to.be.eq(targetPrice.add(1));
      expect(poolLiquidity).to.be.eq(0);

      await addLiquidity(-2 * TICK_SPACING, TICK_SPACING);
      await setNextTimeStamp(startTime + period);

      await burnAll(2);
      await burnAll(1);
    });

    it("TEST 2) swap direction : price down", async () => {
      const { token0, token1 } = await tokenBetween(lp, -4 * TICK_SPACING, 0);
      await swapToken0ToToken1(token0.add(ethers.utils.parseEther("100")));
      await setNextTimeStamp(startTime + period / 2);

      const poolPrice = await pool.price();
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);
      const poolLiquidity = await pool.liquidity();
      expect(poolPrice).to.be.eq(targetPrice.sub(1));
      expect(poolLiquidity).to.be.eq(0);

      await addLiquidity(-12 * TICK_SPACING, 5 * TICK_SPACING);
      await setNextTimeStamp(startTime + period);

      await burnAll(2);
      await burnAll(1);
    });
  });

  /*
   * SINGLE DEPOSIT EDGE CASE
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *                        |<----------------------------------------->|
   *        |<->|                           |<->|       |<->|               |<--------->|
   *        case1                           case2       case3               case4
   *                |<--------->|                                   |<--------->|
   *                case5                                           case6
   */
  describe("# SINGLE DEPOSIT EDGE CASE", async () => {
    let lp: BigNumber;

    let airdrop0 = ethers.utils.parseEther("100");
    let airdrop1 = ethers.utils.parseEther("200");

    beforeEach("deploy Pool", async () => {
      await addLiquidity(-6 * TICK_SPACING, 5 * TICK_SPACING);
      lp = (await poolManager.positions(1)).liquidity;

      let startTime = (await ethers.provider.getBlock("latest")).timestamp + 10;
      let period = 604_800;
      await token0
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop0);
      await token1
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop1);
      await token0.connect(airdropManager).approve(pool.address, airdrop0);
      await token1.connect(airdropManager).approve(pool.address, airdrop1);
      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);
      await setNextTimeStamp(startTime + 100_000);
    });

    it("TEST 1) price range : -10 ~ -9 ", async () => {
      await expect(addLiquidity(-10 * TICK_SPACING, -9 * TICK_SPACING)).to.be
        .not.reverted;

      await expect(addLiquidity(-10 * TICK_SPACING, -7 * TICK_SPACING)).to.be
        .not.reverted;

      await expect(addLiquidity(-10 * TICK_SPACING, -5 * TICK_SPACING)).to.be
        .not.reverted;
    });

    it("TEST 2) price range : -2 ~ -1 ", async () => {
      await expect(addLiquidity(-4 * TICK_SPACING, -1 * TICK_SPACING)).to.be.not
        .reverted;

      await expect(addLiquidity(-4 * TICK_SPACING, -3 * TICK_SPACING)).to.be.not
        .reverted;

      await expect(addLiquidity(-10 * TICK_SPACING, -3 * TICK_SPACING)).to.be
        .not.reverted;
    });

    it("TEST 3) price range : 2 ~ 3 ", async () => {
      await expect(addLiquidity(2 * TICK_SPACING, 3 * TICK_SPACING)).to.be.not
        .reverted;

      await expect(addLiquidity(2 * TICK_SPACING, 7 * TICK_SPACING)).to.be.not
        .reverted;
    });

    it("TEST 4) price range : 6 ~ 9 ", async () => {
      await expect(addLiquidity(6 * TICK_SPACING, 9 * TICK_SPACING)).to.be.not
        .reverted;
    });

    it("TEST 5) price range : -8 ~ -3 ", async () => {
      console.log("1 case");
      await expect(addLiquidity(-8 * TICK_SPACING, -3 * TICK_SPACING)).to.be.not
        .reverted;
      await increaseTime(10_000);

      console.log("2 case");
      await expect(addLiquidity(-8 * TICK_SPACING, -5 * TICK_SPACING)).to.be.not
        .reverted;
      await increaseTime(10_000);

      console.log("3 case");
      await expect(addLiquidity(-8 * TICK_SPACING, -1 * TICK_SPACING)).to.be.not
        .reverted;
      await increaseTime(10_000);

      console.log("4 case");
      await expect(addLiquidity(-10 * TICK_SPACING, -3 * TICK_SPACING)).to.be
        .not.reverted;
      await increaseTime(10_000);
    });

    it("TEST 6) price range : 4 ~ 7 ", async () => {
      await expect(addLiquidity(4 * TICK_SPACING, 7 * TICK_SPACING)).to.be.not
        .reverted;
    });
  });

  /*
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *                |<------------------------------LP0-------------------------------->|
   *
   */
  describe("# UNDERFLOW SCENARIO CASE", function () {
    let baseLP: BigNumber;

    let airdrop0 = ethers.utils.parseEther("1000");
    let airdrop1 = ethers.utils.parseEther("2000");

    beforeEach("deploy Pool", async () => {
      await addLiquidity(-8 * TICK_SPACING, 9 * TICK_SPACING);
      baseLP = (await poolManager.positions(1)).liquidity;

      let startTime = (await ethers.provider.getBlock("latest")).timestamp + 10;
      let period = 604_800;
      await token0
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop0);
      await token1
        .connect(airdropManager)
        .mint(airdropManager.address, airdrop1);
      await token0.connect(airdropManager).approve(pool.address, airdrop0);
      await token1.connect(airdropManager).approve(pool.address, airdrop1);
      await pool
        .connect(airdropManager)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);
      await setNextTimeStamp(startTime + 100_000);
    });

    it("scenario", async () => {
      // reference : https://github.com/code-423n4/2021-09-sushitrident-2-findings/issues/13

      // First, price goes up ( 0 * TICK_SPACING => 4 * TICK_SPACING)
      {
        const { token1 } = await tokenBetween(
          baseLP,
          0 * TICK_SPACING,
          4 * TICK_SPACING
        );
        await swapToken1ToToken0(token1);
      }

      // Second, Alice create a position for uninitialized ticks [-20, 30]
      await addLiquidity(-2 * TICK_SPACING, 3 * TICK_SPACING);
      let aliceLP = (await poolManager.positions(2)).liquidity;

      // Third, price goes up again (4 * TICK_SPACING => 5 * TICK_SPACING)
      {
        const { token1 } = await tokenBetween(
          baseLP,
          4 * TICK_SPACING,
          5 * TICK_SPACING
        );
        await swapToken1ToToken0(token1);
        await increaseTime(10_000); // for airdrop
      }

      // Fourth, Bob create a position for ticks [20, 30]
      await addLiquidity(2 * TICK_SPACING, 3 * TICK_SPACING);
      let bobLP = (await poolManager.positions(2)).liquidity;
      const bobPositionId = 3; // token ID 3

      let positionFee = await poolManager.positionFees(bobPositionId);
      let rangeFeeGrowth = await pool.rangeFeeGrowth(
        2 * TICK_SPACING,
        3 * TICK_SPACING
      );
      console.log(`BOB's initial positionFee Info`);
      console.log(`token0           : ${positionFee.token0amount}`);
      console.log(
        `feeGrowthInside0 : ${positionFee.feeGrowthInside0} (overflow)`
      );
      console.log(
        `rangeFeeGrowth0  : ${rangeFeeGrowth.feeGrowthInside0} (overflow)`
      );
      console.log(`--------------\n`);

      // Third, price goes down (5 * TICK_SPACING => 0 * TICK_SPACING)
      {
        let { token0 } = await tokenBetween(
          baseLP,
          3 * TICK_SPACING,
          5 * TICK_SPACING
        );
        await swapToken0ToToken1(token0);

        token0 = (
          await tokenBetween(
            baseLP.add(aliceLP).add(bobLP),
            2 * TICK_SPACING,
            3 * TICK_SPACING
          )
        ).token0;
        await swapToken0ToToken1(token0);

        token0 = (await tokenBetween(baseLP.add(aliceLP), 0, 2 * TICK_SPACING))
          .token0;
        await swapToken0ToToken1(token0);

        await increaseTime(10_000); // for airdrop
      }

      positionFee = await poolManager.positionFees(bobPositionId);
      rangeFeeGrowth = await pool.rangeFeeGrowth(
        2 * TICK_SPACING,
        3 * TICK_SPACING
      );
      console.log(`BOB's second positionFee Info`);
      console.log(`token0           : ${positionFee.token0amount}`);
      console.log(
        `feeGrowthInside0 : ${positionFee.feeGrowthInside0} (overflow)`
      );
      console.log(
        `rangeFeeGrowth0  : ${rangeFeeGrowth.feeGrowthInside0} (overflow)`
      );
      console.log(`--------------\n`);

      // Third, price goes up again (0 * TICK_SPACING => 2.5 * TICK_SPACING)
      {
        let token1 = (
          await tokenBetween(baseLP.add(aliceLP), 0, 2 * TICK_SPACING)
        ).token1;
        await swapToken1ToToken0(token1);

        token1 = (
          await tokenBetween(
            baseLP.add(aliceLP).add(bobLP),
            2 * TICK_SPACING,
            2.5 * TICK_SPACING
          )
        ).token1;
        await swapToken1ToToken0(token1);

        await increaseTime(600_000); // for airdrop
      }

      positionFee = await poolManager.positionFees(bobPositionId);
      rangeFeeGrowth = await pool.rangeFeeGrowth(
        2 * TICK_SPACING,
        3 * TICK_SPACING
      );
      console.log(`BOB's third positionFee Info`);
      console.log(`token0           : ${positionFee.token0amount}`);
      console.log(
        `feeGrowthInside0 : ${positionFee.feeGrowthInside0} (overflow)`
      );
      console.log(
        `rangeFeeGrowth0  : ${rangeFeeGrowth.feeGrowthInside0} (overflow)`
      );
      console.log(`--------------\n`);
    });
  });
});
