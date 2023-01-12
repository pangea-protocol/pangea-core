import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  PoolRouter,
  ERC20Test,
  MasterDeployer,
  WETH10,
  SafeSwapHelper,
} from "../../../types";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../../harness/utils";
import { expect } from "chai";
import { Pangea } from "../../harness/pangea";

describe("SAFESWAP:HELPER", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;

  let pangea: Pangea;
  let wklay: WETH10;
  let masterDeployer: MasterDeployer;
  let poolFactory: ConcentratedLiquidityPoolFactory;
  let poolManager: ConcentratedLiquidityPoolManager;
  let swapHelper: SafeSwapHelper;
  let pool: ConcentratedLiquidityPool;
  let nativePool: ConcentratedLiquidityPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await Pangea.Instance.init();
    wklay = pangea.weth;
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.concentratedPoolFactory;
    poolManager = pangea.concentratedPoolManager;
    router = pangea.router;
    swapHelper = (await (
      await ethers.getContractFactory("SafeSwapHelper")
    ).deploy()) as SafeSwapHelper;
    await swapHelper.initialize(wklay.address);

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

    await token0
      .connect(trader)
      .mint(trader.address, ethers.constants.MaxUint256.div(2));
    await token0
      .connect(trader)
      .approve(router.address, ethers.constants.MaxUint256);
    await token1
      .connect(trader)
      .mint(trader.address, ethers.constants.MaxUint256.div(2));
    await token1
      .connect(trader)
      .approve(router.address, ethers.constants.MaxUint256);

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

  async function swapToken0ToToken1(
    amountIn: BigNumber,
    amountOutMinimum: BigNumber
  ) {
    return await router.connect(trader).callStatic.exactInputSingle({
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

    return await router.connect(trader).callStatic.exactInputSingle({
      tokenIn: token1.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
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

  async function burnLiquidityAll(positionId: BigNumberish) {
    await poolManager
      .connect(liquidityProvider)
      .burn(
        positionId,
        BigNumber.from(2).pow(100),
        liquidityProvider.address,
        0,
        0,
        false
      );
  }

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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
    });

    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-5 * TICK_SPACING);
      const inputAmount = await getDx(
        liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      expect(exactInputSingle.overInput).to.be.true;

      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      expect(exactInputSingle.maximumAmountIn).to.be.eq(expectedInput);

      if (!expectedInput.eq(inputAmount)) {
        const rOutput = await swapHelper.calculateExactInputSingle(
          pool.address,
          token0.address,
          expectedInput
        );
        expect(rOutput.overInput).to.be.false;
        expect(outputAmount).to.be.eq(rOutput.amountOut);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
    });

    it("TEST 6)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(4 * TICK_SPACING);
      const inputAmount = await getDy(
        liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );

      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );

      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );

      expect(outputAmount).to.be.eq(realOutput);
    });

    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const inputAmount = await getDy(lp1, currentPrice, targetPrice, true);

      // WHEN
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );

      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token0.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token0.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token0.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
      const exactInputSingle = await swapHelper.calculateExactInputSingle(
        pool.address,
        token1.address,
        inputAmount
      );
      const outputAmount = exactInputSingle.amountOut;
      const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
        pool.address,
        token1.address,
        outputAmount
      );
      const expectedInput = exactOutputSingle.amountIn;
      if (!expectedInput.eq(inputAmount)) {
        const rOutput = (
          await swapHelper.calculateExactInputSingle(
            pool.address,
            token1.address,
            expectedInput
          )
        ).amountOut;
        expect(outputAmount).to.be.eq(rOutput);
      }

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
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
   * test 1)                                   |<---|
   * test 2)                           |<-----------|
   * test 3)                     |<-----------------|
   * test 4)           |<---------------------------|
   * test 5)   |<-----------------------------------|
   * test 6)                                        |----->|
   * test 7)                                        |------------->|
   * test 8)                                        |-------------------->|
   * test 9)                                        |--------------------------->|
   */
  describe("# FUSS TEST > RANDOM AMOUNT SWAP ON CONTINUOUS POSITION", async () => {
    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-2 * TICK_SPACING, 1 * TICK_SPACING);
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
      await addLiquidity(-6 * TICK_SPACING, 5 * TICK_SPACING);
      await addLiquidity(-8 * TICK_SPACING, 7 * TICK_SPACING);
      await addLiquidity(-10 * TICK_SPACING, 9 * TICK_SPACING);
    });

    it("FUSS TEST > random value (0 ~ 2^72)", async () => {
      for (let i = 0; i < 100; i++) {
        const inputAmount = ethers.BigNumber.from(ethers.utils.randomBytes(9));
        const tokenIn = Math.random() > 0.5 ? token0.address : token1.address;

        const exactInputSingle = await swapHelper.calculateExactInputSingle(
          pool.address,
          tokenIn,
          inputAmount
        );
        const outputAmount = exactInputSingle.amountOut;
        const exactOutputSingle = await swapHelper.calculateExactOutputSingle(
          pool.address,
          tokenIn,
          outputAmount
        );
        const expectedInput = exactOutputSingle.amountIn;

        if (!expectedInput.eq(inputAmount)) {
          const rOutput = (
            await swapHelper.calculateExactInputSingle(
              pool.address,
              tokenIn,
              expectedInput
            )
          ).amountOut;
          expect(outputAmount).to.be.eq(rOutput);
        }
      }
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
   * test 3)   LP1 Missing
   * test 4)   LP2 Missing
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
      const outputAmount = (
        await swapHelper.calculateExactInputSingle(
          pool.address,
          token0.address,
          inputAmount
        )
      ).amountOut;

      // THEN
      const realOutput = await swapToken0ToToken1(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
    });

    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(6 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(7 * TICK_SPACING);
      const inputAmount = await getDy(lp2, currentPrice, targetPrice, true);

      // WHEN
      const outputAmount = (
        await swapHelper.calculateExactInputSingle(
          pool.address,
          token1.address,
          inputAmount
        )
      ).amountOut;

      // THEN
      const realOutput = await swapToken1ToToken0(
        inputAmount,
        BigNumber.from(0)
      );
      expect(outputAmount).to.be.eq(realOutput);
    });

    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(-7 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(-8 * TICK_SPACING);
      const inputAmount = await getDx(lp1, targetPrice, currentPrice, true);
      const outputAmount = await getDy(lp1, targetPrice, currentPrice, true);

      // WHEN
      await burnLiquidityAll(1);
      const outputAmountResult = (
        await swapHelper.calculateExactInputSingle(
          pool.address,
          token0.address,
          inputAmount
        )
      ).amountOut;
      const inputAmountResult = (
        await swapHelper.calculateExactOutputSingle(
          pool.address,
          token0.address,
          inputAmount
        )
      ).amountIn;

      // THEN
      expect(outputAmountResult).to.be.eq(0);
      expect(inputAmountResult).to.be.eq(0);

      expect(
        router.connect(trader).exactInputSingle({
          tokenIn: token0.address,
          amountIn: inputAmount,
          amountOutMinimum: 0,
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.revertedWith("LiquidityInsufficient");

      expect(
        router.connect(trader).exactOutputSingle({
          tokenIn: token0.address,
          amountOut: outputAmount,
          amountInMaximum: inputAmountResult,
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.revertedWith("LiquidityInsufficient");
    });

    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(6 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(7 * TICK_SPACING);
      const inputAmount = await getDy(lp2, currentPrice, targetPrice, true);
      const outputAmount = await getDx(lp2, currentPrice, targetPrice, true);

      // WHEN
      await burnLiquidityAll(2);

      const outputAmountResult = (
        await swapHelper.calculateExactInputSingle(
          pool.address,
          token1.address,
          inputAmount
        )
      ).amountOut;
      const inputAmountResult = (
        await swapHelper.calculateExactOutputSingle(
          pool.address,
          token1.address,
          inputAmount
        )
      ).amountIn;

      // THEN
      expect(outputAmountResult).to.be.eq(0);
      expect(inputAmountResult).to.be.eq(0);

      expect(
        router.connect(trader).exactInputSingle({
          tokenIn: token1.address,
          amountIn: inputAmount,
          amountOutMinimum: 0,
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.revertedWith("LiquidityInsufficient");

      expect(
        router.connect(trader).exactOutputSingle({
          tokenIn: token1.address,
          amountOut: outputAmount,
          amountInMaximum: inputAmountResult,
          pool: pool.address,
          to: trader.address,
          unwrap: false,
        })
      ).to.be.revertedWith("LiquidityInsufficient");
    });
  });

  describe("# NATIVE POOL SWAP CASE", async () => {
    let liquidity: BigNumber;

    beforeEach("deploy PositionPool", async () => {
      await addLiquidityNative(-4 * TICK_SPACING, 3 * TICK_SPACING);

      liquidity = await nativePool.liquidity();
    });

    it("TEST 1) NATIVE --> TOKEN0", async () => {
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
      const output = (
        await swapHelper.calculateExactInputSingle(
          nativePool.address,
          ethers.constants.AddressZero,
          inputAmount
        )
      ).amountOut;
      const wOutput = (
        await swapHelper.calculateExactInputSingle(
          nativePool.address,
          wklay.address,
          inputAmount
        )
      ).amountOut;

      // THEN
      const result = await router.connect(trader).callStatic.exactInputSingle(
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
      expect(output).to.be.eq(result);
      expect(output).to.be.eq(wOutput);
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
      const outputResult = (
        await swapHelper.calculateExactInput(
          [pool.address, nativePool.address],
          token1.address,
          inputAmount
        )
      ).amountOut;

      const inputResult = (
        await swapHelper.calculateExactOutput(
          [pool.address, nativePool.address],
          token1.address,
          outputResult
        )
      ).amountIn;

      if (!inputResult.eq(inputAmount)) {
        const reOutputResult = (
          await swapHelper.calculateExactInput(
            [pool.address, nativePool.address],
            token1.address,
            inputResult
          )
        ).amountOut;

        expect(reOutputResult).to.be.eq(outputResult);
      }

      // THEN
      const resultExpectInput = await router
        .connect(trader)
        .callStatic.exactInput({
          tokenIn: token1.address,
          amountIn: inputAmount,
          amountOutMinimum: 0,
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: true,
        });
      const resultExpectOutput = await router
        .connect(trader)
        .callStatic.exactOutput({
          tokenIn: token1.address,
          amountOut: outputResult,
          amountInMaximum: ethers.constants.MaxUint256,
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: true,
        });

      expect(outputResult).to.be.eq(resultExpectInput);
      expect(inputResult).to.be.eq(resultExpectOutput);
    });

    it("TEST 1-1) TOKEN1 --> TOKEN0 --> NATIVE", async () => {
      // GIVEN
      const inputAmount = ethers.constants.MaxUint256;

      // WHEN
      const outputResult = await swapHelper.calculateExactInput(
        [pool.address, nativePool.address],
        token1.address,
        inputAmount
      );
      expect(outputResult.overInput).to.be.eq(true);

      const inputResult = await swapHelper.calculateExactOutput(
        [pool.address, nativePool.address],
        token1.address,
        outputResult.amountOut
      );
      expect(outputResult.maximumAmountIn).to.be.eq(inputResult.amountIn);

      if (!inputResult.amountIn.eq(inputAmount)) {
        const reOutputResult = await swapHelper.calculateExactInput(
          [pool.address, nativePool.address],
          token1.address,
          inputResult.amountIn
        );

        expect(reOutputResult.amountOut).to.be.eq(outputResult.amountOut);
      }

      // THEN
      const resultExpectInput = await router
        .connect(trader)
        .callStatic.exactInput({
          tokenIn: token1.address,
          amountIn: inputAmount.div(10),
          amountOutMinimum: 0,
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: true,
        });

      const resultExpectOutput = await router
        .connect(trader)
        .callStatic.exactOutput({
          tokenIn: token1.address,
          amountOut: outputResult.amountOut,
          amountInMaximum: ethers.constants.MaxUint256,
          path: [pool.address, nativePool.address],
          to: trader.address,
          unwrap: true,
        });

      expect(outputResult.amountOut).to.be.eq(resultExpectInput);
      expect(inputResult.amountIn).to.be.eq(resultExpectOutput);
    });

    it("TEST 2) NATIVE --> TOKEN0 --> TOKEN1 ", async () => {
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
      const output = (
        await swapHelper.calculateExactInput(
          [nativePool.address, pool.address],
          ethers.constants.AddressZero,
          inputAmount
        )
      ).amountOut;
      const wOutput = (
        await swapHelper.calculateExactInput(
          [nativePool.address, pool.address],
          wklay.address,
          inputAmount
        )
      ).amountOut;

      const inputResult = (
        await swapHelper.calculateExactOutput(
          [pool.address, nativePool.address],
          token1.address,
          output
        )
      ).amountIn;

      if (!inputResult.eq(inputAmount)) {
        const reOutputResult = (
          await swapHelper.calculateExactInput(
            [pool.address, nativePool.address],
            token1.address,
            inputResult
          )
        ).amountOut;

        expect(reOutputResult).to.be.eq(output);
      }

      // THEN
      const resultExactInputSwap = await router
        .connect(trader)
        .callStatic.exactInput(
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
      const resultExactOutputSwap = await router
        .connect(trader)
        .callStatic.exactOutput(
          {
            tokenIn: ethers.constants.AddressZero,
            amountOut: output,
            amountInMaximum: inputAmount,
            path: [nativePool.address, pool.address],
            to: trader.address,
            unwrap: false,
          },
          { value: inputAmount }
        );

      expect(output).to.be.eq(resultExactInputSwap);
      expect(output).to.be.eq(wOutput);
      expect(inputResult).to.be.eq(resultExactOutputSwap);
    });
  });
});
