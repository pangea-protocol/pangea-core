import { ethers, network } from "hardhat";
import {
  ERC20__factory,
  ERC20Test,
  IProtocolFeeReceiver,
  MasterDeployer,
  MiningPool,
  MiningPoolManager,
  MockYToken,
  PoolRouter,
  YieldPool,
  YieldPoolFactory,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick } from "../../harness/utils";
import { expect } from "chai";
import { YieldPangea } from "./YieldPangea";
import { FakeContract, smock } from "@defi-wonderland/smock";

/**
 * Test for Fee Distribution, depending on position and current price
 *
 * [1] Is it distributed in proportion to the size of liquidity within the price range?
 *
 * [2] Is it distributed correctly when the tick is crossed?
 *
 * [3] Does it operate normally when there is a price range where liquidity is not supplied?
 *
 * [4] Does it operate normally when there is no liquidity in the current price?
 *
 * [5] Does it operate normally when the price impact occurs up to the end price of the pool?
 *
 */
describe("Yield Pool SCENARIO:FEE", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_BASE = 1000000;
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;
  const ZERO = BigNumber.from(0);
  const DUST = 1000;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdropDistributor: SignerWithAddress;
  let protocolFeeTo: SignerWithAddress;

  let pangea: YieldPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: YieldPoolFactory;
  let poolManager: MiningPoolManager;
  let pool: YieldPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let yToken: MockYToken;
  let rewardToken: ERC20Test;
  let protocolFeeReceiver: FakeContract<IProtocolFeeReceiver>;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdropDistributor, protocolFeeTo] =
      await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await YieldPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;
    yToken = pangea.yToken;

    await masterDeployer.setAirdropDistributor(airdropDistributor.address);

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    while (true) {
      token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
      if (token0.address.toLowerCase() < yToken.address.toLowerCase()) {
        // if order is not correct, retry...
        break;
      }
    }

    rewardToken = (await Token.deploy("Reward", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableParameter(
      token0.address,
      yToken.address,
      rewardToken.address,
      BigNumber.from(SWAP_FEE),
      BigNumber.from(TICK_SPACING)
    );
    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "uint24", "uint160", "uint24"],
        [
          token0.address,
          yToken.address,
          rewardToken.address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );

    const poolAddress = (
      await poolFactory.getPools(token0.address, yToken.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<YieldPool>("YieldPool", poolAddress);

    await token0
      .connect(airdropDistributor)
      .approve(poolAddress, ethers.constants.MaxUint256);
    await yToken
      .connect(airdropDistributor)
      .approve(poolAddress, ethers.constants.MaxUint256);

    protocolFeeReceiver = await smock.fake<IProtocolFeeReceiver>(
      "IProtocolFeeReceiver"
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

  async function setNextTimeStamp(currentTime: number) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [currentTime]);
    await ethers.provider.send("evm_mine", []);
  }

  async function clearLPBalance() {
    await token0.burnAll(liquidityProvider.address);
    await yToken
      .connect(liquidityProvider)
      .unstake(await yToken.balanceOf(liquidityProvider.address));
  }

  async function clearBalance() {
    await token0.burnAll(liquidityProvider.address);
    await yToken
      .connect(liquidityProvider)
      .unstake(await yToken.balanceOf(liquidityProvider.address));
  }

  async function lpBalance() {
    return {
      token0: await token0.balanceOf(liquidityProvider.address),
      token1: await yToken.balanceOf(liquidityProvider.address),
      balance: await liquidityProvider.getBalance("latest"),
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
    await yToken.connect(trader).stake({ value: amountIn });
    await yToken.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: yToken.address,
      amountIn,
      amountOutMinimum,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  function calculateSwapFee(amount: BigNumber) {
    // 10% => governance fee
    return amount.mul(SWAP_FEE).div(SWAP_BASE).mul(9).div(10);
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

    await yToken.connect(liquidityProvider).stake({ value: amountDesired });
    await yToken
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
        await yToken.balanceOf(liquidityProvider.address)
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

    await yToken.connect(liquidityProvider).stake({ value: amountDesired });
    await yToken
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
        await yToken.balanceOf(liquidityProvider.address)
      ),
    };
  }

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * | GOV FEE      :  50% |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * Liquidity Provider
   *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
   *                        |<---LP4--->|                   |<---LP5--->|
   *
   * test 1)                                |<------|
   * test 2)                        |<--------------|
   * test 3)            |<--------------------------|
   * test 4)                                        |-->|
   * test 5)                                        |-------------->|

   */
  describe("# FEE DISTRIBUTION AFTER SWAP CASE (CONTINUOUS)", async () => {
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
     *
     * Liquidity Provider
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp1 = await mintNewPosition(-10 * TICK_SPACING, -5 * TICK_SPACING, 1);
      lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      lp3 = await mintNewPosition(4 * TICK_SPACING, 9 * TICK_SPACING, 1);
      lp4 = await mintNewPosition(-6 * TICK_SPACING, -3 * TICK_SPACING, 1);
      lp5 = await mintNewPosition(2 * TICK_SPACING, 5 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 1)                                |<------|
     */
    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);

      // THEN
      const originalOutput = await getDy(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const expectedSwapFee = calculateSwapFee(originalOutput);

      const balance = await lpBalance();

      expect(withInPrecision(expectedSwapFee, balance.token1, 10)).to.be.true;
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 2)                        |<--------------|
     */
    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);

      const lp2Amount = await getDx(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const lp4Amount = await getDx(
        lp4.liquidity,
        targetPrice,
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const inputAmount = lp2Amount.add(lp4Amount);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
      const lp2fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp4.positionId, liquidityProvider.address, false);
      const lp4fee = await lpBalance();

      // THEN
      const lp2Out = await getDy(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const lp4Out = await getDy(
        lp4.liquidity,
        targetPrice,
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );

      const expectedlp2Fee = calculateSwapFee(lp2Out);
      const expectedlp4Fee = calculateSwapFee(lp4Out);

      expect(withInPrecision(expectedlp2Fee, lp2fee.token1, 10)).to.be.true;
      expect(withInPrecision(expectedlp4Fee, lp4fee.token1, 10)).to.be.true;
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 3)            |<--------------------------|
     */
    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-4 * TICK_SPACING);

      const lp1Amount = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-7 * TICK_SPACING),
        await getPriceAtTick(-5 * TICK_SPACING),
        true
      );
      const lp2Amount = await getDx(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const lp4Amount = await getDx(
        lp4.liquidity,
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const inputAmount = lp1Amount.add(lp2Amount).add(lp4Amount);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      const lp1fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
      const lp2fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp4.positionId, liquidityProvider.address, false);
      const lp4fee = await lpBalance();

      // THEN
      const lp1Out = await getDy(
        lp1.liquidity,
        await getPriceAtTick(-7 * TICK_SPACING),
        await getPriceAtTick(-5 * TICK_SPACING),
        true
      );
      const lp2Out = await getDy(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const lp4Out = await getDy(
        lp4.liquidity,
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const expectedlp1Fee = calculateSwapFee(lp1Out);
      const expectedlp2Fee = calculateSwapFee(lp2Out);
      const expectedlp4Fee = calculateSwapFee(lp4Out);

      expect(withInPrecision(expectedlp1Fee, lp1fee.token1, 10)).to.be.true;
      expect(withInPrecision(expectedlp2Fee, lp2fee.token1, 10)).to.be.true;
      expect(withInPrecision(expectedlp4Fee, lp4fee.token1, 10)).to.be.true;
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 4)                                        |-->|
     */
    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(1 * TICK_SPACING);
      const inputAmount = await getDy(
        lp2.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);

      // THEN
      const originalOutput = await getDx(
        lp2.liquidity,
        currentPrice,
        targetPrice,
        true
      );
      const expectedSwapFee = calculateSwapFee(originalOutput);

      const balance = await lpBalance();

      expect(withInPrecision(expectedSwapFee, balance.token0, 10)).to.be.true;
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 5)                                        |---------->|
     */
    it("TEST 5)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(3 * TICK_SPACING);

      const lp2Amount = await getDy(
        lp2.liquidity,
        currentPrice,
        targetPrice,
        true
      );
      const lp5Amount = await getDy(
        lp5.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        targetPrice,
        true
      );
      const inputAmount = lp2Amount.add(lp5Amount);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
      const lp2fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp5.positionId, liquidityProvider.address, false);
      const lp5fee = await lpBalance();

      // THEN
      const lp2Out = await getDx(
        lp2.liquidity,
        currentPrice,
        targetPrice,
        true
      );
      const lp5Out = await getDx(
        lp5.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        targetPrice,
        true
      );

      const expectedlp2Fee = calculateSwapFee(lp2Out);
      const expectedlp5Fee = calculateSwapFee(lp5Out);

      expect(withInPrecision(expectedlp2Fee, lp2fee.token0, 10)).to.be.true;
      expect(withInPrecision(expectedlp5Fee, lp5fee.token0, 10)).to.be.true;
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
     *                        |<---LP4--->|                   |<---LP5--->|
     * test 6)                                        |------------------------------>|
     */
    it("TEST 6)", async () => {
      // GIVEN
      const lp2Amount = await getDy(
        lp2.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const lp3Amount = await getDy(
        lp3.liquidity,
        await getPriceAtTick(4 * TICK_SPACING),
        await getPriceAtTick(8 * TICK_SPACING),
        true
      );
      const lp5Amount = await getDy(
        lp5.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const inputAmount = lp2Amount.add(lp3Amount).add(lp5Amount);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
      const lp2fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp3.positionId, liquidityProvider.address, false);
      const lp3fee = await lpBalance();
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp5.positionId, liquidityProvider.address, false);
      const lp5fee = await lpBalance();

      // THEN
      const lp2Out = await getDx(
        lp2.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const lp3Out = await getDx(
        lp3.liquidity,
        await getPriceAtTick(4 * TICK_SPACING),
        await getPriceAtTick(8 * TICK_SPACING),
        true
      );
      const lp5Out = await getDx(
        lp5.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const expectedlp2Fee = calculateSwapFee(lp2Out);
      const expectedlp3Fee = calculateSwapFee(lp3Out);
      const expectedlp5Fee = calculateSwapFee(lp5Out);

      expect(withInPrecision(expectedlp2Fee, lp2fee.token0, 10)).to.be.true;
      expect(withInPrecision(expectedlp3Fee, lp3fee.token0, 10)).to.be.true;
      expect(withInPrecision(expectedlp5Fee, lp5fee.token0, 10)).to.be.true;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * | GOV FEE      :  50% |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * Liquidity Provider
   * X1     |<-------LP1------->|   |<------------LP2---------->|   |<-------LP3------->|
   * X2     |<-------LP4------->|   |<------------LP5---------->|   |<-------LP6------->|
   * X3     |<-------LP7------->|   |<------------LP8---------->|   |<-------LP9------->|
   *
   * test 1)                                |<------|
   * test 2)                |<----------------------|
   * test 3)                                        |-->|
   * test 4)                                        |----------------->|
   */
  describe("# FEE DISTRIBUTION AFTER SWAP CASE (NOT CONTINUOUS)", async () => {
    let lp1: LPInfo;
    let lp2: LPInfo;
    let lp3: LPInfo;
    let lp4: LPInfo;
    let lp5: LPInfo;
    let lp6: LPInfo;
    let lp7: LPInfo;
    let lp8: LPInfo;
    let lp9: LPInfo;
    let lps: LPInfo[];

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     * X1     |<-------LP1------->|   |<------------LP4---------->|   |<-------LP7------->|
     * X2     |<-------LP2------->|   |<------------LP5---------->|   |<-------LP8------->|
     * X3     |<-------LP3------->|   |<------------LP6---------->|   |<-------LP9------->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp1 = await mintNewPosition(-10 * TICK_SPACING, -5 * TICK_SPACING, 1);
      lp2 = await mintNewPosition(-10 * TICK_SPACING, -5 * TICK_SPACING, 2);
      lp3 = await mintNewPosition(-10 * TICK_SPACING, -5 * TICK_SPACING, 3);
      lp4 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      lp5 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 2);
      lp6 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 3);
      lp7 = await mintNewPosition(4 * TICK_SPACING, 9 * TICK_SPACING, 1);
      lp8 = await mintNewPosition(4 * TICK_SPACING, 9 * TICK_SPACING, 2);
      lp9 = await mintNewPosition(4 * TICK_SPACING, 9 * TICK_SPACING, 3);
      lps = [lp1, lp1, lp2, lp3, lp4, lp5, lp6, lp7, lp8, lp9];
      await clearLPBalance();
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     * X1     |<-------LP1------->|   |<------------LP4---------->|   |<-------LP7------->|
     * X2     |<-------LP2------->|   |<------------LP5---------->|   |<-------LP8------->|
     * X3     |<-------LP3------->|   |<------------LP6---------->|   |<-------LP9------->|
     *
     * test 1)                                |<------|
     */
    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const totalLiquidity = lp4.liquidity
        .add(lp5.liquidity)
        .add(lp6.liquidity);
      const inputAmount = await getDx(
        totalLiquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const balanceResult: { [name: number]: LPBalance } = {};
      for (let i = 1; i < 10; i++) {
        await clearLPBalance();
        await poolManager
          .connect(liquidityProvider)
          .collect(i, liquidityProvider.address, false);
        balanceResult[i] = await lpBalance();
      }

      // THEN
      for (let i of [1, 2, 3, 7, 8, 9]) {
        expect(balanceResult[i].token0).to.be.eq(ZERO);
        expect(balanceResult[i].token1).to.be.eq(ZERO);
      }

      for (let i of [4, 5, 6]) {
        const lpOut = await getDy(
          lps[i].liquidity,
          targetPrice,
          currentPrice,
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token0).to.be.eq(ZERO);
        expect(withInPrecision(token1, expectedlpFee, 10)).to.be.true;
      }
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     * X1     |<-------LP1------->|   |<------------LP4---------->|   |<-------LP7------->|
     * X2     |<-------LP2------->|   |<------------LP5---------->|   |<-------LP8------->|
     * X3     |<-------LP3------->|   |<------------LP6---------->|   |<-------LP9------->|
     *
     * test 2)                |<----------------------|
     */
    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-6 * TICK_SPACING);
      const span0Liquidity = lp1.liquidity
        .add(lp2.liquidity)
        .add(lp3.liquidity);
      const span1Liquidity = lp4.liquidity
        .add(lp5.liquidity)
        .add(lp6.liquidity);
      const span0Amount = await getDx(
        span0Liquidity,
        targetPrice,
        await getPriceAtTick(-5 * TICK_SPACING),
        true
      );
      const span1Amount = await getDx(
        span1Liquidity,
        await getPriceAtTick(-4 * TICK_SPACING),
        currentPrice,
        true
      );
      const inputAmount = span0Amount.add(span1Amount);

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const balanceResult: { [name: number]: LPBalance } = {};
      for (let i = 1; i < 10; i++) {
        await clearLPBalance();
        await poolManager
          .connect(liquidityProvider)
          .collect(i, liquidityProvider.address, false);
        balanceResult[i] = await lpBalance();
      }

      // THEN
      for (let i of [1, 2, 3]) {
        const lpOut = await getDy(
          lps[i].liquidity,
          targetPrice,
          await getPriceAtTick(-5 * TICK_SPACING),
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token0).to.be.eq(ZERO);
        expect(withInPrecision(token1, expectedlpFee, 10)).to.be.true;
      }
      for (let i of [4, 5, 6]) {
        const lpOut = await getDy(
          lps[i].liquidity,
          await getPriceAtTick(-4 * TICK_SPACING),
          currentPrice,
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token0).to.be.eq(ZERO);
        expect(withInPrecision(token1, expectedlpFee, 10)).to.be.true;
      }
      for (let i of [7, 8, 9]) {
        expect(balanceResult[i].token0).to.be.eq(ZERO);
        expect(balanceResult[i].token1).to.be.eq(ZERO);
      }
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     * X1     |<-------LP1------->|   |<------------LP4---------->|   |<-------LP7------->|
     * X2     |<-------LP2------->|   |<------------LP5---------->|   |<-------LP8------->|
     * X3     |<-------LP3------->|   |<------------LP6---------->|   |<-------LP9------->|
     *
     * test 3)                                        |-->|
     */
    it("TEST 3)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const totalLiquidity = lp4.liquidity
        .add(lp5.liquidity)
        .add(lp6.liquidity);
      const inputAmount = await getDy(
        totalLiquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const balanceResult: { [name: number]: LPBalance } = {};
      for (let i = 1; i < 10; i++) {
        await clearLPBalance();
        await poolManager
          .connect(liquidityProvider)
          .collect(i, liquidityProvider.address, false);
        balanceResult[i] = await lpBalance();
      }

      // THEN
      for (let i of [1, 2, 3, 7, 8, 9]) {
        expect(balanceResult[i].token0).to.be.eq(ZERO);
        expect(balanceResult[i].token1).to.be.eq(ZERO);
      }

      for (let i of [4, 5, 6]) {
        const lpOut = await getDx(
          lps[i].liquidity,
          currentPrice,
          targetPrice,
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token1).to.be.eq(ZERO);
        expect(withInPrecision(token0, expectedlpFee, 10)).to.be.true;
      }
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     * Liquidity Provider
     * X1     |<-------LP1------->|   |<------------LP4---------->|   |<-------LP7------->|
     * X2     |<-------LP2------->|   |<------------LP5---------->|   |<-------LP8------->|
     * X3     |<-------LP3------->|   |<------------LP6---------->|   |<-------LP9------->|
     *
     * test 4)                                        |---------------------->|
     */
    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(6 * TICK_SPACING);
      const span1Liquidity = lp4.liquidity
        .add(lp5.liquidity)
        .add(lp6.liquidity);
      const span2Liquidity = lp7.liquidity
        .add(lp8.liquidity)
        .add(lp9.liquidity);
      const span1Amount = await getDy(
        span1Liquidity,
        currentPrice,
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const span2Amount = await getDy(
        span2Liquidity,
        await getPriceAtTick(4 * TICK_SPACING),
        targetPrice,
        true
      );
      const inputAmount = span1Amount.add(span2Amount);

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const balanceResult: { [name: number]: LPBalance } = {};
      for (let i = 1; i < 10; i++) {
        await clearLPBalance();
        await poolManager
          .connect(liquidityProvider)
          .collect(i, liquidityProvider.address, false);
        balanceResult[i] = await lpBalance();
      }

      // THEN
      for (let i of [1, 2, 3]) {
        expect(balanceResult[i].token0).to.be.eq(ZERO);
        expect(balanceResult[i].token1).to.be.eq(ZERO);
      }

      for (let i of [4, 5, 6]) {
        const lpOut = await getDx(
          lps[i].liquidity,
          currentPrice,
          await getPriceAtTick(3 * TICK_SPACING),
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token1).to.be.eq(ZERO);
        expect(withInPrecision(token0, expectedlpFee, 10)).to.be.true;
      }

      for (let i of [7, 8, 9]) {
        const lpOut = await getDx(
          lps[i].liquidity,
          await getPriceAtTick(4 * TICK_SPACING),
          await getPriceAtTick(6 * TICK_SPACING),
          true
        );
        const expectedlpFee = calculateSwapFee(lpOut);

        const { token0, token1 } = balanceResult[i];
        expect(token1).to.be.eq(ZERO);
        expect(withInPrecision(token0, expectedlpFee, 10)).to.be.true;
      }
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * | GOV FEE      :  50% |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * Liquidity Provider
   *                                |<------------LP1---------->|
   *                                |<------------LP2---------->|
   * <SWAP>
   *  LP1 add more liquidity and claim fee
   *
   * test 1)                                |<------|
   * test 2)                                        |----->|
   */
  describe("# FEE DISTRIBUTION AFTER ADDITIONAL MINTING LIQUIDITY CASE", async () => {
    let lp1: LPInfo;
    let lp2: LPInfo;

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->|
     *                                |<------------LP2---------->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->|
     *                                |<------------LP2---------->|
     * test 1)                                |<------|
     */
    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const totalLiquidity = lp1.liquidity.add(lp2.liquidity);
      const inputAmount = await getDx(
        totalLiquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();

      await swapToken0ToToken1(inputAmount, BigNumber.from(0));

      await addLiquidity(BigNumber.from(1), 10); // <= add Liquidity (but no fee)

      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(1, liquidityProvider.address, false);
      const balance1 = await lpBalance();

      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(2, liquidityProvider.address, false);
      const balance2 = await lpBalance();

      expect(balance1.token0).to.be.eq(balance2.token0);
      expect(balance1.token1).to.be.eq(balance2.token1);
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->|
     *                                |<------------LP2---------->|
     * test 2)                                        |------>|
     */
    it("TEST 2)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const totalLiquidity = lp1.liquidity.add(lp2.liquidity);
      const inputAmount = await getDy(
        totalLiquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await addLiquidity(BigNumber.from(1), 10); // <= add Liquidity (but no fee)

      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(1, liquidityProvider.address, false);
      const balance1 = await lpBalance();

      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(2, liquidityProvider.address, false);
      const balance2 = await lpBalance();

      expect(balance1.token0).to.be.eq(balance2.token0);
      expect(balance1.token1).to.be.eq(balance2.token1);
    });
  });

  describe("# FEE DISTRIBUTION WITH YIELD CASE", async () => {
    let lp: LPInfo;

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP----------->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("TEST 1) increases total Staking = 10 KLAY", async () => {
      // FIRST, increaseTotal Staking
      const givenTotalStaking = ethers.utils.parseEther("10");
      await yToken.increaseTotalStaking(givenTotalStaking);

      // Test yTokenEarned
      const yTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;
      expect(
        givenTotalStaking.mul(9).div(10).sub(yTokenEarned).abs()
      ).to.be.lte(DUST);
    });

    it("TEST 2) increases total Staking = 10 KLAY (liquidityProvider exists another)", async () => {
      // FIRST, increaseTotal Staking
      await yToken
        .connect(liquidityProvider)
        .stake({ value: ethers.utils.parseEther("100") });
      const givenTotalStaking = ethers.utils.parseEther("10");
      await yToken.increaseTotalStaking(givenTotalStaking);

      // Test yTokenEarned
      const yTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;
      expect(
        givenTotalStaking.div(2).mul(9).div(10).sub(yTokenEarned).abs()
      ).to.be.lte(DUST);
    });

    it("TEST 3) mint after increases total Staking = 10 KLAY", async () => {
      // FIRST, increaseTotal Staking
      await yToken
        .connect(liquidityProvider)
        .stake({ value: ethers.utils.parseEther("100") });
      const givenTotalStaking = ethers.utils.parseEther("10");
      await yToken.increaseTotalStaking(givenTotalStaking);

      const beforeYTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;

      // Second, mint new Position
      await mintNewPosition(-10 * TICK_SPACING, -5 * TICK_SPACING, 1);

      // Test yTokenEarned
      const afterYTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;

      expect(beforeYTokenEarned).to.be.eq(afterYTokenEarned);
    });

    it("TEST 4) partial burn after increases total Staking = 10 KLAY", async () => {
      // FIRST, increaseTotal Staking
      await yToken
        .connect(liquidityProvider)
        .stake({ value: ethers.utils.parseEther("100") });
      const givenTotalStaking = ethers.utils.parseEther("10");
      await yToken.increaseTotalStaking(givenTotalStaking);

      const beforeYTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;

      // Second, burn partial Position
      await poolManager
        .connect(liquidityProvider)
        .burn(
          lp.positionId,
          lp.liquidity.div(10),
          liquidityProvider.address,
          0,
          0,
          false
        );
      await clearLPBalance();

      // Test yTokenEarned
      const afterYTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;

      expect(beforeYTokenEarned).to.be.eq(afterYTokenEarned);
    });

    it("TEST 5) partial burn and collect after increases total Staking = 10 KLAY", async () => {
      // FIRST, increaseTotal Staking
      await yToken
        .connect(liquidityProvider)
        .stake({ value: ethers.utils.parseEther("100") });
      const givenTotalStaking = ethers.utils.parseEther("10");
      await yToken.increaseTotalStaking(givenTotalStaking);

      const beforeYTokenEarned = (await poolManager.positionFees(lp.positionId))
        .token1amount;

      // Second, burn partial Position
      await poolManager
        .connect(liquidityProvider)
        .burn(
          lp.positionId,
          lp.liquidity.div(10),
          liquidityProvider.address,
          0,
          0,
          false
        );
      await clearLPBalance();

      // Test yTokenEarned
      await poolManager
        .connect(liquidityProvider)
        .collect(lp.positionId, liquidityProvider.address, false);

      expect(beforeYTokenEarned).to.be.eq(
        await yToken.balanceOf(liquidityProvider.address)
      );
    });
  });

  describe("# FEE DISTRIBUTION AFTER PROTOCOL FEE RECEIVER CASE", async () => {
    let lp: LPInfo;

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP----------->|
     */
    beforeEach("deploy PositionPool", async () => {
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("TEST 1) contract receive pool's protocol fee", async () => {
      // GIVEN
      await masterDeployer.setProtocolFeeTo(protocolFeeReceiver.address);

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const inputAmount = await getDy(
        lp.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const protocolFee = await pool.callStatic.collectProtocolFee();
      await pool.collectProtocolFee();

      // THEN
      expect(protocolFeeReceiver.collectFeeCallback).to.be.calledWith(
        [await pool.token0(), await pool.token1()],
        [protocolFee.amount0, protocolFee.amount1]
      );
    });

    it("TEST 2) EOA receive pool's protocol fee", async () => {
      // GIVEN
      await masterDeployer.setProtocolFeeTo(protocolFeeTo.address);

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(2 * TICK_SPACING);
      const inputAmount = await getDy(
        lp.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const protocolFee = await pool.callStatic.collectProtocolFee();
      await pool.collectProtocolFee();

      // THEN
      const token0Amount = await (
        await ERC20__factory.connect(await pool.token0(), ethers.provider)
      ).balanceOf(protocolFeeTo.address);
      const token1Amount = await (
        await ERC20__factory.connect(await pool.token1(), ethers.provider)
      ).balanceOf(protocolFeeTo.address);

      expect(token0Amount).to.be.eq(protocolFee.amount0);
      expect(token1Amount).to.be.eq(protocolFee.amount1);
    });
  });
});

interface LPBalance {
  token0: BigNumber;
  token1: BigNumber;
}

interface LPInfo {
  positionId: BigNumber;
  liquidity: BigNumber;
  token0: BigNumber;
  token1: BigNumber;
}
