import {ethers, network} from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  ERC20Test,
  MasterDeployer,
  PoolRouter,
  SwapHelper,
  WETH10,
  ZapHelper,
} from "../../../types";
import {BigNumber, BigNumberish} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {getDx, getDy, getPriceAtTick, sortTokens} from "../../harness/utils";
import {expect} from "chai";
import {Pangea} from "../../harness/pangea";

describe("ZAP:HELPER", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;
  const DUST = 1000;

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
  let swapHelper: SwapHelper;
  let pool: ConcentratedLiquidityPool;
  let nativePool: ConcentratedLiquidityPool;
  let router: PoolRouter;
  let zapHelper: ZapHelper;
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
    swapHelper = pangea.swapHelper;

    const ZapHelper = await ethers.getContractFactory("ZapHelper");
    zapHelper = await ZapHelper.deploy() as ZapHelper;

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
        .approve(router.address, ethers.constants.MaxUint256.div(2));
    await token1
        .connect(trader)
        .mint(trader.address, ethers.constants.MaxUint256.div(2));
    await token1
        .connect(trader)
        .approve(router.address, ethers.constants.MaxUint256.div(2));

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
            {value: amountDesired}
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.true
      expect(result.amount0.sub(inputAmount).abs()).to.be.lt(DUST)
      expect(result.amount1.sub(outputAmount).abs()).to.be.lt(DUST)
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.true
      expect(result.amount0.sub(inputAmount).abs()).to.be.lt(DUST)
      expect(result.amount1.sub(outputAmount).abs()).to.be.lt(DUST)
    });

    it("TEST 3)", async () => {
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.false
      expect(result.amount0.sub(outputAmount).abs()).to.be.lt(DUST)
      expect(result.amount1.sub(inputAmount).abs()).to.be.lt(DUST)
    });

    it("TEST 4)", async () => {
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.false
      expect(result.amount0.sub(outputAmount).abs()).to.be.lt(DUST)
      expect(result.amount1.sub(inputAmount).abs()).to.be.lt(DUST)
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
   * test 1)       <--------------------------------|
   * test 2)                                        |-------------------------->|
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);

      expect(result.zeroForOne).to.be.eq(true)
      expect(result.amount0.sub(inputAmount).abs()).to.be.lte(DUST)
      expect(result.amount1.sub(outputAmount).abs()).to.be.lte(DUST)
    });

    it("TEST 2)", async () => {
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);

      expect(result.zeroForOne).to.be.eq(false)
      expect(result.amount0.sub(outputAmount).abs()).to.be.lte(DUST)
      expect(result.amount1.sub(inputAmount).abs()).to.be.lte(DUST)
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
   * test 1)        |<------------------------------|
   * test 2)                                        |--------------------------------->|
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.eq(true);
      expect(result.amount0.sub(inputAmount).abs()).to.be.lt(DUST);
      expect(result.amount1.sub(outputAmount).abs()).to.be.lt(DUST);
    });

    it("TEST 2)", async () => {
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

      const result = await zapHelper.expectAmount(pool.address, targetPrice);
      expect(result.zeroForOne).to.be.eq(false);
      expect(result.amount0.sub(outputAmount).abs()).to.be.lt(DUST);
      expect(result.amount1.sub(inputAmount).abs()).to.be.lt(DUST);
    });
  });
});
