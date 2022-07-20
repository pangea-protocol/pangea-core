import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  PoolRouter,
  ERC20Test,
  MasterDeployer,
  IProtocolFeeReceiver,
  AirdropDistributor,
  PoolDashboard,
  SwapHelper,
} from "../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../harness/utils";
import { encodeCreatePoolData } from "../harness/helpers";
import { Pangea } from "../harness/pangea";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { expect } from "chai";

describe("SCENARIO:DASHBOARD", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_BASE = 1000000;
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;
  const ZERO = BigNumber.from(0);
  const DUST_VALUE = 10;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;

  let protocolFeeTo: SignerWithAddress;

  let pangea: Pangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: ConcentratedLiquidityPoolFactory;
  let poolManager: ConcentratedLiquidityPoolManager;
  let poolDashboard: PoolDashboard;
  let swapHelper: SwapHelper;
  let pool: ConcentratedLiquidityPool;
  let airdropDistributor: AirdropDistributor;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let protocolFeeReceiver: FakeContract<IProtocolFeeReceiver>;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, protocolFeeTo] =
      await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await Pangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.concentratedPoolFactory;
    poolManager = pangea.concentratedPoolManager;
    airdropDistributor = pangea.airdropDistributor;
    poolDashboard = pangea.poolDashboard;
    swapHelper = pangea.swapHelper;
    router = pangea.router;

    await masterDeployer.setAirdropDistributor(airdropDistributor.address);

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    await token0.mint(
      airdropDistributor.address,
      ethers.utils.parseEther("10000")
    );
    await token1.mint(
      airdropDistributor.address,
      ethers.utils.parseEther("10000")
    );

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

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool",
      poolAddress
    );

    await token0
      .connect(deployer)
      .mint(deployer.address, ethers.utils.parseEther("1000000"));
    await token1
      .connect(deployer)
      .mint(deployer.address, ethers.utils.parseEther("1000000"));
    await token0
      .connect(deployer)
      .approve(airdropDistributor.address, ethers.utils.parseEther("1000000"));
    await token1
      .connect(deployer)
      .approve(airdropDistributor.address, ethers.utils.parseEther("1000000"));

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

  async function lpBalance() {
    return {
      token0: await token0.balanceOf(liquidityProvider.address),
      token1: await token1.balanceOf(liquidityProvider.address),
    };
  }

  async function swapToken0ToToken1(
    amountIn: BigNumber,
    amountOutMinimum: BigNumber
  ) {
    // For test, trader always mint token
    await token0.connect(trader).mint(trader.address, amountIn);
    await token0.connect(trader).approve(router.address, amountIn);

    const output = await swapHelper.calculateExactInputSingle(
      pool.address,
      token0.address,
      amountIn
    );

    await router.connect(trader).exactInputSingle({
      tokenIn: token0.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });

    return output.amountOut;
  }

  async function swapToken1ToToken0(
    amountIn: BigNumber,
    amountOutMinimum: BigNumber
  ) {
    // For test, trader always mint token
    await token1.connect(trader).mint(trader.address, amountIn);
    await token1.connect(trader).approve(router.address, amountIn);

    const output = await swapHelper.calculateExactInputSingle(
      pool.address,
      token1.address,
      amountIn
    );

    await router.connect(trader).exactInputSingle({
      tokenIn: token1.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
    return output.amountOut;
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

  function withInPrecision(
    value0: BigNumber,
    value1: BigNumber,
    precision: number
  ) {
    const base = BigNumber.from(10).pow(precision);
    const value = base.sub(value0.mul(base).div(value1)).abs();
    return value.lte(1);
  }

  /*
   * |-----------------------|
   * | SWAP FEE     : 2000   |
   * | TICK SPACING :   40   |
   * | GOV FEE      :  50%   |
   * | AIRDROP0     : 10 ETH |
   * | AIRDROP1     : 20 ETH |
   * |-----------------------|
   *                                          CURRENT PRICE
   *                                                 |
   *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   *  Liquidity Provider
   *                                 |<------------LP1---------->|
   *                         |<---LP2--->|                   |<---LP3--->|
   *         |<---LP4--->|                                                   |<---LP5--->|
   * test 1 )
   * test 2 )                                |<------|
   * test 3 )                          |<------------|
   * test 4 )        |<------------------------------|
   * test 5 )|<--------------------------------------|
   * test 6 )                                        |-->|
   * test 7 )                                        |------------->|
   * test 8 )                                        |---------------------------->|
   * test 9 )                                        |---------------------------------->|
   * test 10) with Airdrop
   * test 11) with Aridrop twice
   */
  describe("# DASHBOARD CASE", async () => {
    let lp1: LPInfo;
    let lp2: LPInfo;
    let lp3: LPInfo;
    let lp4: LPInfo;
    let lp5: LPInfo;

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      lp2 = await mintNewPosition(-6 * TICK_SPACING, -3 * TICK_SPACING, 1);
      lp3 = await mintNewPosition(2 * TICK_SPACING, 5 * TICK_SPACING, 1);
      lp4 = await mintNewPosition(-10 * TICK_SPACING, -7 * TICK_SPACING, 1);
      lp5 = await mintNewPosition(6 * TICK_SPACING, 9 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    async function aggregateLPFees() {
      let fee0 = BigNumber.from(0);
      let fee1 = BigNumber.from(0);
      for (let i of [
        lp1.positionId,
        lp2.positionId,
        lp3.positionId,
        lp4.positionId,
        lp5.positionId,
      ]) {
        const positionFee = await poolManager.positionFees(i);
        fee0 = fee0.add(positionFee.token0amount);
        fee1 = fee1.add(positionFee.token1amount);
      }
      return { fee0, fee1 };
    }

    it("TEST 1)", async () => {
      // WHEN
      const cFees = await poolDashboard.cumulativeFees(pool.address);

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0).to.be.lte(lpFees.fee0);
      expect(cFees.fee1).to.be.lte(lpFees.fee1);
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                         |<------|
     */
    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      const output = await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume1, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                 |<--------------|
     */
    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-3 * TICK_SPACING),
        currentPrice,
        true
      );
      const span1 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1);

      // WHEN
      const output = await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume1, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                             |<------------------|
     */
    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-3 * TICK_SPACING),
        currentPrice,
        true
      );
      const span1 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const span2 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-5 * TICK_SPACING),
        await getPriceAtTick(-4 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2);

      // WHEN
      const output = await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume1, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                 |<------------------------------|
     */
    it("TEST 5)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-3 * TICK_SPACING),
        currentPrice,
        true
      );
      const span1 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const span2 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-4 * TICK_SPACING),
        true
      );
      const span3 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-8 * TICK_SPACING),
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2).add(span3);

      // WHEN
      const output = await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume1, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *         |<--------------------------------------|
     */
    it("TEST 6)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-3 * TICK_SPACING),
        currentPrice,
        true
      );
      const span1 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const span2 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-4 * TICK_SPACING),
        true
      );
      const span3 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-11 * TICK_SPACING),
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2).add(span3);

      // WHEN
      const output = await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume1, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                                 |-->
     */
    it("TEST 6)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDy(
        lp1.liquidity,
        currentPrice,
        await getPriceAtTick(1 * TICK_SPACING),
        true
      );
      const inputAmount = span0;

      // WHEN
      const output = await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume0, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                                 |-------->|
     */
    it("TEST 7)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDy(
        lp1.liquidity,
        currentPrice,
        await getPriceAtTick(1 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp1.liquidity,
        await getPriceAtTick(1 * TICK_SPACING),
        await getPriceAtTick(2.5 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1);

      // WHEN
      const output = await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume0, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                                 |-------------->|
     */
    it("TEST 8)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDy(
        lp1.liquidity,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp1.liquidity.add(lp3.liquidity),
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(4 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1);

      // WHEN
      const output = await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume0, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                                 |-------------------------->|
     */
    it("TEST 9)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDy(
        lp1.liquidity,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp1.liquidity.add(lp3.liquidity),
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const span2 = await getDy(
        lp5.liquidity,
        await getPriceAtTick(6 * TICK_SPACING),
        await getPriceAtTick(7 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2);

      // WHEN
      const output = await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume0, 10)).to.be
        .true;
    });

    /*                                                 |
     *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                 |<------------LP1---------->|
     *         |<---LP4--->|   |<---LP2--->|                   |<---LP3--->|   |<---LP5--->|
     *
     *                                                 |---------------------------------->|
     */
    it("TEST 10)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const span0 = await getDy(
        lp1.liquidity,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp1.liquidity.add(lp3.liquidity),
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const span2 = await getDy(
        lp5.liquidity,
        await getPriceAtTick(6 * TICK_SPACING),
        await getPriceAtTick(9 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2);

      // WHEN
      const output = await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const cFees = await poolDashboard.cumulativeFees(pool.address);
      const tradingVolume = await poolDashboard.cumulativeTradingVolume(
        pool.address
      );

      // THEN
      const lpFees = await aggregateLPFees();
      expect(cFees.fee0.sub(lpFees.fee0).abs()).to.be.lte(DUST_VALUE);
      expect(cFees.fee1.sub(lpFees.fee1).abs()).to.be.lte(DUST_VALUE);
      expect(withInPrecision(output, tradingVolume.tradingVolume0, 10)).to.be
        .true;
    });
  });

  /*
   * |-----------------------|
   * | SWAP FEE     : 2000   |
   * | TICK SPACING :   40   |
   * | GOV FEE      :  50%   |
   * | AIRDROP0     : 10 ETH |
   * | AIRDROP1     : 20 ETH |
   * |-----------------------|
   *                                          CURRENT PRICE
   *                                                 |
   *    -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   *  ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   *  Liquidity Provider
   *                                 |<------------LP1---------->|
   * test 1 ) do airdrop
   * test 2 ) do airdrop on going
   *
   */
  describe("# DASHBOARD CASE (AIRDROP)", async () => {
    let lp1: LPInfo;

    beforeEach("", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
    });

    it("TEST 1)", async () => {
      // GIVEN
      const amount0 = ethers.utils.parseEther("100");
      const amount1 = ethers.utils.parseEther("200");
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);

      // WHEN
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );
      await airdropDistributor.airdropAll();
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );

      // THEN
      const airdrops = await poolDashboard.cumulativeAirdrop(pool.address);
      expect(withInPrecision(amount0, airdrops.airdrop0, 10)).to.be.true;
      expect(withInPrecision(amount1, airdrops.airdrop1, 10)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const amount0 = ethers.utils.parseEther("100");
      const amount1 = ethers.utils.parseEther("200");
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);

      // WHEN
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );
      await airdropDistributor.airdropAll();
      await setNextTimeStamp(
        (await airdropDistributor.epochStartTime()).add(3600 * 24).toNumber()
      );

      // THEN
      const airdrops = await poolDashboard.cumulativeAirdrop(pool.address);
      expect(withInPrecision(amount0.div(7), airdrops.airdrop0, 10)).to.be.true;
      expect(withInPrecision(amount1.div(7), airdrops.airdrop1, 10)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const amount0 = ethers.utils.parseEther("100");
      const amount1 = ethers.utils.parseEther("200");

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );
      await airdropDistributor.airdropAll();

      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );

      await airdropDistributor.airdropAll();
      await setNextTimeStamp(
        (await airdropDistributor.epochStartTime()).add(3600 * 24).toNumber()
      );

      // THEN
      const airdrops = await poolDashboard.cumulativeAirdrop(pool.address);
      const tradingFees = await poolDashboard.cumulativeTradingFees(
        pool.address
      );

      expect(tradingFees.tradingFee0).to.be.eq(0);
      expect(tradingFees.tradingFee1).to.be.eq(0);
      expect(withInPrecision(amount0.mul(8).div(7), airdrops.airdrop0, 10)).to
        .be.true;
      expect(withInPrecision(amount1.mul(8).div(7), airdrops.airdrop1, 10)).to
        .be.true;
    });

    it("TEST 4)", async () => {
      // GIVEN
      const amount0 = ethers.utils.parseEther("100");
      const amount1 = ethers.utils.parseEther("200");

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );
      await airdropDistributor.airdropAll();

      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(
        (await airdropDistributor.nextEpochStartTime()).toNumber()
      );

      await airdropDistributor.airdropAll();
      await swapToken1ToToken0(BigNumber.from(1), BigNumber.from(0)); // no swap fee
      await setNextTimeStamp(
        (await airdropDistributor.epochStartTime()).add(3600 * 24).toNumber()
      );

      // THEN
      const fees = await poolDashboard.cumulativeFees(pool.address);
      const tradingFees = await poolDashboard.cumulativeTradingFees(
        pool.address
      );
      const airdrops = await poolDashboard.cumulativeAirdrop(pool.address);

      expect(tradingFees.tradingFee0).to.be.eq(0);
      expect(tradingFees.tradingFee1).to.be.eq(0);
      expect(withInPrecision(fees.fee0, airdrops.airdrop0, 5)).to.be.true;
      expect(withInPrecision(fees.fee1, airdrops.airdrop1, 5)).to.be.true;
      expect(withInPrecision(amount0.mul(8).div(7), airdrops.airdrop0, 10)).to
        .be.true;
      expect(withInPrecision(amount1.mul(8).div(7), airdrops.airdrop1, 10)).to
        .be.true;
    });
  });
});

interface LPInfo {
  positionId: BigNumber;
  liquidity: BigNumber;
  token0: BigNumber;
  token1: BigNumber;
}
