import { ethers, network } from "hardhat";
import {
  ERC20Test,
  MasterDeployer,
  MiningPoolManager,
  MockGCKlay,
  PoolRouter,
  SwapHelper,
  WETH10,
  GCKlayPool,
  GCKlayPoolFactory,
} from "../../../types";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick } from "../../harness/utils";
import { expect } from "chai";
import { describe } from "mocha";
import { GCKlayPangea } from "./GCKlayPangea";

/**
 * Test for Swap in GCKlay Pool
 *
 * [1] Is the swap within the price range calculated in the form of X*Y=K?
 *
 * [2] If it is out of the tick, is it calculated normally as the L value changes?
 *
 * [3] if it exceeds the price range supplied to the pool, is it calculated normally?
 *
 * [4] Is it calculated by passing through the zero liquidity price range normally?
 *
 * [5] Is it calculated normally via multiple hop swap pools?
 *
 * [6] Are Native tokens swapped normally?
 *
 * [7] Does it work normally if the liquidity in the current price becomes zero?
 *
 */
describe("GCKlay Pool SCENARIO:SWAP", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_BASE = 1000000;
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 20;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;

  let pangea: GCKlayPangea;
  let wklay: WETH10;
  let masterDeployer: MasterDeployer;
  let poolFactory: GCKlayPoolFactory;
  let poolManager: MiningPoolManager;
  let pool: GCKlayPool;
  let nativePool: GCKlayPool;
  let swapHelper: SwapHelper;
  let router: PoolRouter;
  let token0: ERC20Test;
  let mockGCKlay: MockGCKlay;
  let rewardToken: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await GCKlayPangea.Instance.init();
    wklay = pangea.weth;
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;
    swapHelper = pangea.swapHelper;
    mockGCKlay = pangea.gcKlay;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    while (true) {
      token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
      if (token0.address.toLowerCase() < mockGCKlay.address.toLowerCase()) {
        // if order is not correct, retry...
        break;
      }
    }

    rewardToken = (await Token.deploy("REWARD", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint24", "uint160", "uint24"],
        [
          token0.address,
          mockGCKlay.address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );

    const [tokenN0, tokenN1] =
      mockGCKlay.address.toLowerCase() < wklay.address.toLowerCase()
        ? [mockGCKlay.address, wklay.address]
        : [wklay.address, mockGCKlay.address];

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
      await poolFactory.getPools(token0.address, mockGCKlay.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<GCKlayPool>("GCKlayPool", poolAddress);

    const nativePoolAddress = (
      await poolFactory.getPools(mockGCKlay.address, wklay.address, 0, 1)
    )[0];
    nativePool = await ethers.getContractAt<GCKlayPool>(
      "GCKlayPool",
      nativePoolAddress
    );

    await mockGCKlay.stake({ value: ethers.utils.parseEther("100") });
    await deployer.sendTransaction({
      to: mockGCKlay.address,
      value: ethers.utils.parseEther("1"),
    });

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
    await token0.burnAll(liquidityProvider.address);
    await mockGCKlay
      .connect(liquidityProvider)
      .unstake(await mockGCKlay.balanceOf(liquidityProvider.address));
  }

  async function depositReward(value: BigNumberish) {
    await deployer.sendTransaction({ to: mockGCKlay.address, value });
  }

  async function traderBalance() {
    return {
      token0: await token0.balanceOf(trader.address),
      token1: await mockGCKlay.balanceOf(trader.address),
    };
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
    await mockGCKlay.connect(trader).stake({ value: amountIn });
    await mockGCKlay.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: mockGCKlay.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
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

  async function addLiquidity(lowerTick: number, upperTick: number) {
    const amount0Desired = ethers.utils.parseEther("100");
    await token0.mint(liquidityProvider.address, amount0Desired.mul(4));
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amount0Desired.mul(4));

    const amount1Desired = ethers.utils.parseEther("100");
    await mockGCKlay
      .connect(liquidityProvider)
      .stake({ value: amount1Desired.mul(4) });
    await mockGCKlay
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
    await mockGCKlay.connect(liquidityProvider).stake({ value: amountDesired });
    await mockGCKlay
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

  describe("ABNORMAL SWAP CASE", async () => {
    let liquidity: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);

      liquidity = await nativePool.liquidity();
    });

    it("REVERT CASE ) exactInputSingle: TooLittleReceived", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const amountIn = await getDx(liquidity, targetPrice, currentPrice, true);

      const output = (
        await swapHelper.calculateExactInputSingle(
          pool.address,
          wklay.address,
          amountIn
        )
      ).amountOut;

      // WHEN
      await token0.connect(trader).mint(trader.address, amountIn);
      await token0.connect(trader).approve(router.address, amountIn);

      await expect(
        router.connect(trader).exactInputSingle({
          tokenIn: token0.address,
          amountIn,
          amountOutMinimum: output.add(1),
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("REVERT CASE ) exactInput: TooLittleReceived", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const amountIn = await getDx(liquidity, targetPrice, currentPrice, true);

      const output = (
        await swapHelper.calculateExactInput(
          [pool.address, nativePool.address],
          mockGCKlay.address,
          amountIn
        )
      ).amountOut;

      // WHEN
      await mockGCKlay.connect(trader).stake({ value: amountIn });
      await mockGCKlay.connect(trader).approve(router.address, amountIn);

      await expect(
        router.connect(trader).exactInput({
          tokenIn: mockGCKlay.address,
          amountIn,
          amountOutMinimum: output.add(1),
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("REVERT CASE ) exactInputSingle: Wrong pool", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const amountIn = await getDx(liquidity, targetPrice, currentPrice, true);

      // WHEN
      await token0.connect(trader).mint(trader.address, amountIn);
      await token0.connect(trader).approve(router.address, amountIn);

      await expect(
        router.connect(trader).exactInputSingle({
          tokenIn: token0.address,
          amountIn,
          amountOutMinimum: 0,
          pool: trader.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("REVERT CASE ) exactInput: Wrong pool", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const amountIn = await getDx(liquidity, targetPrice, currentPrice, true);

      // WHEN
      await token0.connect(trader).mint(trader.address, amountIn);
      await token0.connect(trader).approve(router.address, amountIn);

      await expect(
        router.connect(trader).exactInput({
          tokenIn: token0.address,
          amountIn,
          amountOutMinimum: 0,
          path: [pool.address, nativePool.address, trader.address],
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("REVERT CASE ) receive revert", async () => {
      await expect(
        trader.sendTransaction({
          to: router.address,
          value: ethers.utils.parseEther("1"),
        })
      ).to.be.reverted;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * LP1                            <--------------------------->
   *
   * test 1)                                |<------|
   * test 2)                        |<--------------|
   * test 3)                     <..|<--------------|
   * test 4)                                        |------>|
   * test 5)                                        |---------->|
   * test 6)                                        |-----------|..>
   */
  describe("# SINGLE POSITION SWAP CASE", async () => {
    let liquidity: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);

      liquidity = await pool.liquidity();
    });

    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const expectedOutput = (
        await getDy(liquidity, targetPrice, currentPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const expectedOutput = (
        await getDy(liquidity, targetPrice, currentPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const marginPrice = await getPriceAtTick(-4 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(-5 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const expectedOutput = (
        await getDy(liquidity, marginPrice, currentPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(marginPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const inputAmount = await getDy(
        liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const expectedOutput = (
        await getDx(liquidity, currentPrice, targetPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 5)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);
      const inputAmount = await getDy(
        liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const expectedOutput = (
        await getDx(liquidity, currentPrice, targetPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 6)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const marginPrice = await getPriceAtTick(3 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(4 * TICK_SPACING);
      const inputAmount = await getDy(
        liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const expectedOutput = (
        await getDx(liquidity, currentPrice, marginPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(marginPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * LP1                            <--------------------------->
   * LP2    |<--------->|
   * LP3                                                                    |<--------->|
   *
   * test 1)                                |<------|
   * test 2)       <--------------------------------|
   * test 3)<---------------------------------------|
   * test 4)                                        |------>|
   * test 5)                                        |-------------------------->|
   * test 6)                                        |---------------------------------->|
   */
  describe("# NOT CONTINUOUS POSITION SWAP CASE", async () => {
    let lp1: BigNumber;
    let lp2: BigNumber;
    let lp3: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidity(-10 * TICK_SPACING, -7 * TICK_SPACING);
      await addLiquidity(6 * TICK_SPACING, 9 * TICK_SPACING);

      lp1 = (await poolManager.positions(1)).liquidity;
      lp2 = (await poolManager.positions(2)).liquidity;
      lp3 = (await poolManager.positions(3)).liquidity;
    });

    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(lp1, targetPrice, currentPrice, true);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const expectedOutput = (await getDy(lp1, targetPrice, currentPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-8 * TICK_SPACING);
      const spanDx1 = await getDx(
        lp1,
        await getPriceAtTick(-4 * TICK_SPACING),
        currentPrice,
        true
      );
      const spanDx2 = await getDx(
        lp2,
        targetPrice,
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const inputAmount = spanDx1.add(spanDx2);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const spanDy1 = (
        await getDy(
          lp1,
          await getPriceAtTick(-4 * TICK_SPACING),
          currentPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDy(
          lp2,
          targetPrice,
          await getPriceAtTick(-7 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-10 * TICK_SPACING);
      const spanDx1 = await getDx(
        lp1,
        await getPriceAtTick(-4 * TICK_SPACING),
        currentPrice,
        true
      );
      const spanDx2 = await getDx(
        lp2,
        targetPrice,
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const inputAmount = spanDx1.add(spanDx2);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const spanDy1 = (
        await getDy(
          lp1,
          await getPriceAtTick(-4 * TICK_SPACING),
          currentPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDy(
          lp2,
          targetPrice,
          await getPriceAtTick(-7 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const inputAmount = await getDy(lp1, currentPrice, targetPrice, true);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const expectedOutput = (await getDx(lp1, currentPrice, targetPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 5)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(7 * TICK_SPACING);
      const spanDx1 = await getDy(
        lp1,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const spanDx2 = await getDy(
        lp3,
        await getPriceAtTick(6 * TICK_SPACING),
        targetPrice,
        true
      );
      const inputAmount = spanDx1.add(spanDx2);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const spanDy1 = (
        await getDx(
          lp1,
          currentPrice,
          await getPriceAtTick(3 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDx(
          lp3,
          await getPriceAtTick(6 * TICK_SPACING),
          targetPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 6)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(9 * TICK_SPACING);
      const spanDx1 = await getDy(
        lp1,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const spanDx2 = await getDy(
        lp3,
        await getPriceAtTick(6 * TICK_SPACING),
        targetPrice,
        true
      );
      const inputAmount = spanDx1.add(spanDx2);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const spanDy1 = (
        await getDx(
          lp1,
          currentPrice,
          await getPriceAtTick(3 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDx(
          lp3,
          await getPriceAtTick(6 * TICK_SPACING),
          targetPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });
  });

  /*
         * |---------------------|
         * | SWAP FEE     : 2000 |
         * | TICK SPACING :   40 |
         * |---------------------|
         *                                         CURRENT PRICE
         *                                                |
         *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
         * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
         *
         * LP1                            <--------------------------->
         * LP2    |<----------------------------------------------------------------->|
         * LP3    |<--------->|
         * LP4                                                                    |<----------------->|
         *
         * test 1)                     |<-----------------|
         * test 2)        |<------------------------------|
         * test 3)                                        |--------------------------------->|

         */
  describe("# CONTINUOUS POSITION SWAP CASE", async () => {
    let lp1: BigNumber;
    let lp2: BigNumber;
    let lp3: BigNumber;
    let lp4: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidity(-10 * TICK_SPACING, 7 * TICK_SPACING);
      await addLiquidity(-10 * TICK_SPACING, -7 * TICK_SPACING);
      await addLiquidity(6 * TICK_SPACING, 11 * TICK_SPACING);

      lp1 = (await poolManager.positions(1)).liquidity;
      lp2 = (await poolManager.positions(2)).liquidity;
      lp3 = (await poolManager.positions(3)).liquidity;
      lp4 = (await poolManager.positions(4)).liquidity;
    });

    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-5 * TICK_SPACING);
      const spanDx1 = await getDx(
        lp1.add(lp2),
        await getPriceAtTick(-4 * TICK_SPACING),
        currentPrice,
        true
      );
      const spanDx2 = await getDx(
        lp2,
        targetPrice,
        await getPriceAtTick(-4 * TICK_SPACING),
        true
      );

      const inputAmount = spanDx1.add(spanDx2);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const spanDy1 = (
        await getDy(
          lp1.add(lp2),
          await getPriceAtTick(-4 * TICK_SPACING),
          currentPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDy(
          lp2,
          targetPrice,
          await getPriceAtTick(-4 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-8 * TICK_SPACING);
      const spanDx1 = await getDx(
        lp1.add(lp2),
        await getPriceAtTick(-4 * TICK_SPACING),
        currentPrice,
        true
      );
      const spanDx2 = await getDx(
        lp2,
        await getPriceAtTick(-7 * TICK_SPACING),
        await getPriceAtTick(-4 * TICK_SPACING),
        true
      );
      const spanDx3 = await getDx(
        lp2.add(lp3),
        targetPrice,
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );

      const inputAmount = spanDx1.add(spanDx2).add(spanDx3);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const spanDy1 = (
        await getDy(
          lp1.add(lp2),
          await getPriceAtTick(-4 * TICK_SPACING),
          currentPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDy(
          lp2,
          await getPriceAtTick(-7 * TICK_SPACING),
          await getPriceAtTick(-4 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy3 = (
        await getDy(
          lp2.add(lp3),
          targetPrice,
          await getPriceAtTick(-7 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2).add(spanDy3);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(9 * TICK_SPACING);
      const spanDx1 = await getDy(
        lp1.add(lp2),
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const spanDx2 = await getDy(
        lp2,
        await getPriceAtTick(3 * TICK_SPACING),
        await getPriceAtTick(6 * TICK_SPACING),
        true
      );
      const spanDx3 = await getDy(
        lp2.add(lp4),
        await getPriceAtTick(6 * TICK_SPACING),
        await getPriceAtTick(7 * TICK_SPACING),
        true
      );
      const spanDx4 = await getDy(
        lp4,
        await getPriceAtTick(7 * TICK_SPACING),
        targetPrice,
        true
      );

      const inputAmount = spanDx1.add(spanDx2).add(spanDx3).add(spanDx4);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const spanDy1 = (
        await getDx(
          lp1.add(lp2),
          currentPrice,
          await getPriceAtTick(3 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy2 = (
        await getDx(
          lp2,
          await getPriceAtTick(3 * TICK_SPACING),
          await getPriceAtTick(6 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy3 = (
        await getDx(
          lp2.add(lp4),
          await getPriceAtTick(6 * TICK_SPACING),
          await getPriceAtTick(7 * TICK_SPACING),
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const spanDy4 = (
        await getDx(
          lp4,
          await getPriceAtTick(7 * TICK_SPACING),
          targetPrice,
          true
        )
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      const expectedOutput = spanDy1.add(spanDy2).add(spanDy3).add(spanDy4);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * LP1    |<--------->|
   * LP2                                                                    |<--------->|
   *
   * test 1)       <--------------------------------|
   * test 2)                                        |-------------------------->|
   */
  describe("# CURRENT LIQUIDITY EMPTY POSITION SWAP CASE", async () => {
    let lp1: BigNumber;
    let lp2: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-10 * TICK_SPACING, -7 * TICK_SPACING);
      await addLiquidity(6 * TICK_SPACING, 9 * TICK_SPACING);

      lp1 = (await poolManager.positions(1)).liquidity;
      lp2 = (await poolManager.positions(2)).liquidity;
    });

    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(-7 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(-8 * TICK_SPACING);
      const inputAmount = await getDx(lp1, targetPrice, currentPrice, true);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token1;
      const expectedOutput = (await getDy(lp1, targetPrice, currentPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(6 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(7 * TICK_SPACING);
      const inputAmount = await getDy(lp2, currentPrice, targetPrice, true);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));

      // THEN
      const result = (await traderBalance()).token0;
      const expectedOutput = (await getDx(lp2, currentPrice, targetPrice, true))
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);
      const poolPrice = (await pool.getPriceAndNearestTicks())._price;

      expect(withInPrecision(targetPrice, poolPrice, 8)).to.be.true;
      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });
  });

  describe("# ERC20-NATIVE SWAP CASE", async () => {
    let liquidity: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);

      liquidity = await nativePool.liquidity();
    });

    it("TEST 1) ERC20 --> NATIVE", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-1 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      // For test, trader always mint token
      await mockGCKlay.connect(trader).stake({ value: inputAmount });
      await mockGCKlay.connect(trader).approve(router.address, inputAmount);

      const before = await trader.getBalance();
      const tx = await router.connect(trader).exactInputSingle({
        tokenIn: mockGCKlay.address,
        amountIn: inputAmount,
        amountOutMinimum: 0,
        pool: nativePool.address,
        to: trader.address,
        unwrap: true,
      });
      const receipt = await tx.wait();
      const after = await trader.getBalance();

      // THEN
      const result = after.sub(before).add(receipt.gasUsed.mul(tx.gasPrice!));
      const expectedOutput = (
        await getDy(liquidity, targetPrice, currentPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      expect(withInPrecision(result, expectedOutput, 8)).to.be.true;
    });

    it("TEST 2) NATIVE --> ERC20", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-1 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await router.connect(trader).exactInputSingle(
        {
          tokenIn: ethers.constants.AddressZero,
          amountIn: inputAmount,
          amountOutMinimum: 0,
          pool: nativePool.address,
          to: trader.address,
          unwrap: false,
        },
        { value: inputAmount }
      );

      // THEN
      const balance = await traderBalance();
      const expectedOutput = (
        await getDy(liquidity, targetPrice, currentPrice, true)
      )
        .mul(SWAP_BASE - SWAP_FEE)
        .div(SWAP_BASE);

      expect(withInPrecision(balance.token1, expectedOutput, 8)).to.be.true;
    });
  });

  describe("# MULTIPLE HOPES SWAP CASE", async () => {
    let liquidity: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);

      liquidity = await nativePool.liquidity();
    });

    it("TEST 1) TOKEN1 --> TOKEN0 --> NATIVE", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-1 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      // For test, trader always mint token
      await token0.connect(trader).mint(trader.address, inputAmount);
      await token0.connect(trader).approve(router.address, inputAmount);

      const before = await trader.getBalance();
      const tx = await router.connect(trader).exactInput({
        tokenIn: token0.address,
        amountIn: inputAmount,
        amountOutMinimum: 0,
        path: [pool.address, nativePool.address],
        to: trader.address,
        unwrap: true,
      });
      const receipt = await tx.wait();
      const after = await trader.getBalance();

      // THEN
      const result = after.sub(before).add(receipt.gasUsed.mul(tx.gasPrice!));
      expect(result.gt(0)).to.be.true;
    });

    it("TEST 2) TOKEN1 --> TOKEN0 --> WRAPPED", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-1 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      // For test, trader always mint token
      await token0.connect(trader).mint(trader.address, inputAmount);
      await token0.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactInput({
        tokenIn: token0.address,
        amountIn: inputAmount,
        amountOutMinimum: 0,
        path: [pool.address, nativePool.address],
        to: trader.address,
        unwrap: false,
      });

      // THEN
      const result = await wklay.balanceOf(trader.address);
      expect(result.gt(0)).to.be.true;
    });

    it("TEST 3) NATIVE --> TOKEN0 --> TOKEN1", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-1 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      // For test, trader always mint token
      await mockGCKlay.connect(trader).stake({ value: inputAmount });
      await mockGCKlay.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactInput(
        {
          tokenIn: ethers.constants.AddressZero,
          amountIn: inputAmount,
          amountOutMinimum: 0,
          path: [nativePool.address, pool.address],
          to: trader.address,
          unwrap: false,
        },
        { value: inputAmount }
      );

      const balance = await traderBalance();

      // THEN
      expect(balance.token1.gt(0)).to.be.true;
    });
  });

  describe("EXACT OUTPUT & EXACT OUTPUT SINGLE CASE", async () => {
    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-2 * TICK_SPACING, 1 * TICK_SPACING);
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);

      await addLiquidityNative(-2 * TICK_SPACING, 1 * TICK_SPACING);
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);
    });

    it("revert exactOutputSingle: TooLittleAmountIn", async () => {
      const inputAmount = ethers.utils.parseEther("1");

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();
      await token0.connect(trader).mint(trader.address, inputAmount);
      await token0.connect(trader).approve(router.address, inputAmount);

      await expect(
        router.connect(trader).exactOutputSingle({
          tokenIn: token0.address,
          amountOut: outputAmount,
          amountInMaximum: 0,
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("revert exactOutputSingle: TooLittleAmountIn when send klay", async () => {
      const inputAmount = ethers.utils.parseEther("1");

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        nativePool.address,
        ethers.constants.AddressZero,
        inputAmount
      );
      const amountOut = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();

      await expect(
        router.connect(trader).exactOutputSingle(
          {
            tokenIn: ethers.constants.AddressZero,
            amountOut,
            amountInMaximum: inputAmount,
            pool: pool.address,
            to: trader.address,
            unwrap: false,
          },
          { value: inputAmount.div(2) }
        )
      ).to.be.reverted;
    });

    it("revert exactOutput: TooLittleAmountIn", async () => {
      const inputAmount = ethers.utils.parseEther("1");

      const exactInputSingle = await swapHelper.calculateExactInput(
        [pool.address, nativePool.address],
        mockGCKlay.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();
      await token0.connect(trader).mint(trader.address, inputAmount);
      await token0.connect(trader).approve(router.address, inputAmount);

      await expect(
        router.connect(trader).exactOutput({
          tokenIn: token0.address,
          amountOut: outputAmount,
          amountInMaximum: 0,
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: false,
        })
      ).to.be.reverted;
    });

    it("revert exactOutput: TooLittleAmountIn when send klay", async () => {
      const inputAmount = ethers.utils.parseEther("1");

      const exactInputSingle = await swapHelper.calculateExactInput(
        [nativePool.address, pool.address],
        ethers.constants.AddressZero,
        inputAmount
      );
      const amountOut = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();

      await expect(
        router.connect(trader).exactOutput(
          {
            tokenIn: ethers.constants.AddressZero,
            amountOut,
            amountInMaximum: inputAmount,
            path: [nativePool.address, pool.address],
            to: trader.address,
            unwrap: false,
          },
          { value: inputAmount.div(2) }
        )
      ).to.be.reverted;
    });

    it("exactOutputSingle erc20 --> erc20", async () => {
      const inputAmount = ethers.utils.parseEther("1");
      const tokenIn = token0;

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        tokenIn.address,
        inputAmount
      );
      const amountOut = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();
      await tokenIn.connect(trader).mint(trader.address, inputAmount);
      await tokenIn.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactOutputSingle({
        tokenIn: tokenIn.address,
        amountOut,
        amountInMaximum: inputAmount,
        pool: pool.address,
        to: trader.address,
        unwrap: false,
      });
      expect(
        (await mockGCKlay.balanceOf(trader.address)).sub(amountOut).abs()
      ).to.be.lte(1);
    });

    it("exactOutputSingle native --> erc20", async () => {
      const inputAmount = ethers.utils.parseEther("1");

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        nativePool.address,
        ethers.constants.AddressZero,
        inputAmount
      );
      const amountOut = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();

      await router.connect(trader).exactOutputSingle(
        {
          tokenIn: ethers.constants.AddressZero,
          amountOut,
          amountInMaximum: inputAmount,
          pool: nativePool.address,
          to: trader.address,
          unwrap: false,
        },
        { value: inputAmount }
      );

      expect(
        (await mockGCKlay.balanceOf(trader.address)).sub(amountOut).abs()
      ).to.be.lte(1);
    });

    it("exactOutputSingle erc20 --> native", async () => {
      const inputAmount = ethers.utils.parseEther("1");
      const tokenIn = mockGCKlay;

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        nativePool.address,
        ethers.constants.AddressZero,
        inputAmount
      );
      const amountOut = exactInputSingle.amountOut;

      // WHEN
      await clearBalance();
      await tokenIn.connect(trader).stake({ value: inputAmount });
      await tokenIn.connect(trader).approve(router.address, inputAmount);
      const before = await trader.getBalance();
      const tx = await router.connect(trader).exactOutputSingle({
        tokenIn: tokenIn.address,
        amountOut,
        amountInMaximum: inputAmount,
        pool: nativePool.address,
        to: trader.address,
        unwrap: true,
      });
      const receipt = await tx.wait();

      const result = (await trader.getBalance())
        .add(tx.gasPrice!.mul(receipt.gasUsed))
        .sub(before);
      expect(result).to.be.eq(amountOut);
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * LP1                                    <----------->
   * LP2                            |<------------------------->|
   * LP3                    |<----------------------------------------->|
   * LP4            |<--------------------------------------------------------->|
   * LP5   |<-------------------------------------------------------------------------->|
   *
   */
  describe("# EXACT OUTPUT CASE", async () => {
    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-2 * TICK_SPACING, 1 * TICK_SPACING);
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidity(-6 * TICK_SPACING, 5 * TICK_SPACING);
      await addLiquidity(-8 * TICK_SPACING, 7 * TICK_SPACING);
      await addLiquidity(-10 * TICK_SPACING, 9 * TICK_SPACING);

      await addLiquidityNative(-2 * TICK_SPACING, 1 * TICK_SPACING);
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidityNative(-6 * TICK_SPACING, 5 * TICK_SPACING);
      await addLiquidityNative(-8 * TICK_SPACING, 7 * TICK_SPACING);
      await addLiquidityNative(-10 * TICK_SPACING, 9 * TICK_SPACING);
    });

    it("TEST 1) EXACT OUTPUT SINGLE ERC20 --> ERC20 CASE> ", async () => {
      await clearBalance();

      const inputAmount = ethers.utils.parseEther("50");
      const tokenIn = token0;

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        tokenIn.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;

      // WHEN
      await tokenIn.connect(trader).mint(trader.address, inputAmount);
      await tokenIn.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactOutputSingle({
        tokenIn: tokenIn.address,
        amountOut: outputAmount,
        amountInMaximum: inputAmount,
        pool: pool.address,
        to: trader.address,
        unwrap: false,
      });

      const realOutput =
        tokenIn.address === token0.address
          ? await mockGCKlay.balanceOf(trader.address)
          : await token0.balanceOf(trader.address);

      expect(realOutput.sub(outputAmount)).to.be.lte(1);
    });

    it("TEST 2) EXACT OUTPUT SINGLE ERC20 --> ERC20 CASE> ", async () => {
      await clearBalance();

      const inputAmount = ethers.utils.parseEther("50");
      const tokenIn = mockGCKlay;

      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        tokenIn.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;

      // WHEN
      await mockGCKlay.connect(trader).stake({ value: inputAmount });
      await mockGCKlay.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactOutputSingle({
        tokenIn: tokenIn.address,
        amountOut: outputAmount,
        amountInMaximum: inputAmount,
        pool: pool.address,
        to: trader.address,
        unwrap: false,
      });

      const realOutput =
        tokenIn.address === token0.address
          ? await mockGCKlay.balanceOf(trader.address)
          : await token0.balanceOf(trader.address);

      expect(realOutput).to.be.eq(outputAmount);
    });

    it("TEST 3) EXACT OUTPUT ERC20 --> ERC20 CASE> ", async () => {
      await clearBalance();

      const inputAmount = ethers.utils.parseEther("50");
      const tokenIn = token0;

      const exactInput = await swapHelper.calculateExactInput(
        [pool.address, nativePool.address],
        tokenIn.address,
        inputAmount
      );
      const outputAmount = exactInput.amountOut;

      // WHEN
      await token0.connect(trader).mint(trader.address, inputAmount);
      await token0.connect(trader).approve(router.address, inputAmount);

      await router.connect(trader).exactOutput({
        tokenIn: tokenIn.address,
        amountOut: outputAmount,
        amountInMaximum: inputAmount,
        path: [pool.address, nativePool.address],
        to: trader.address,
        unwrap: false,
      });

      const realOutput = await wklay.balanceOf(trader.address);
      expect(realOutput).to.be.eq(outputAmount);
    });

    it("TEST 4) EXACT OUTPUT NATIVE --> ERC20 CASE> ", async () => {
      await clearBalance();

      const inputAmount = ethers.utils.parseEther("50");
      const tokenIn = ethers.constants.AddressZero;

      const exactInput = await swapHelper.calculateExactInput(
        [nativePool.address, pool.address],
        tokenIn,
        inputAmount
      );
      const outputAmount = exactInput.amountOut;

      // WHEN
      await router.connect(trader).exactOutput(
        {
          tokenIn,
          amountOut: outputAmount,
          amountInMaximum: inputAmount,
          path: [nativePool.address, pool.address],
          to: trader.address,
          unwrap: false,
        },
        { value: inputAmount }
      );

      const realOutput = await token0.balanceOf(trader.address);
      expect(realOutput).to.be.eq(outputAmount);
    });

    it("TEST 5) EXACT OUTPUT ERC20 --> NATIVE CASE> ", async () => {
      await clearBalance();

      const inputAmount = ethers.utils.parseEther("50");
      const tokenIn = token0;

      const exactInput = await swapHelper.calculateExactInput(
        [pool.address, nativePool.address],
        tokenIn.address,
        inputAmount
      );
      const outputAmount = exactInput.amountOut;

      // WHEN
      await tokenIn.connect(trader).mint(trader.address, inputAmount);
      await tokenIn.connect(trader).approve(router.address, inputAmount);
      const before = await trader.getBalance();

      const tx = await router.connect(trader).exactOutput({
        tokenIn: tokenIn.address,
        amountOut: outputAmount,
        amountInMaximum: inputAmount,
        path: [pool.address, nativePool.address],
        to: trader.address,
        unwrap: true,
      });
      const receipt = await tx.wait();

      const realOutput = (await trader.getBalance())
        .add(receipt.gasUsed.mul(tx.gasPrice!))
        .sub(before);
      expect(realOutput).to.be.eq(outputAmount);
    });
  });
});
