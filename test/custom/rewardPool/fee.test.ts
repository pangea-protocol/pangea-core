import { ethers, network } from "hardhat";
import {
  ERC20__factory,
  ERC20Test,
  IProtocolFeeReceiver,
  MasterDeployer,
  PoolRouter,
  RewardLiquidityPool,
  RewardLiquidityPoolFactory,
  RewardLiquidityPoolManager,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../../harness/utils";
import { expect } from "chai";
import { RewardPangea } from "./RewardPangea";
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
describe("Reward Liquidity Pool SCENARIO:FEE", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_BASE = 1000000;
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;
  const ZERO = BigNumber.from(0);

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdropDistributor: SignerWithAddress;
  let protocolFeeTo: SignerWithAddress;

  let pangea: RewardPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: RewardLiquidityPoolFactory;
  let poolManager: RewardLiquidityPoolManager;
  let pool: RewardLiquidityPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let rewardToken: ERC20Test;
  let protocolFeeReceiver: FakeContract<IProtocolFeeReceiver>;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdropDistributor, protocolFeeTo] =
      await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await RewardPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;

    await masterDeployer.setAirdropDistributor(airdropDistributor.address);

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    rewardToken = (await Token.deploy("Reward", "R", 18)) as ERC20Test;

    await token0.mint(
      airdropDistributor.address,
      ethers.utils.parseEther("10000")
    );
    await token1.mint(
      airdropDistributor.address,
      ethers.utils.parseEther("10000")
    );

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableParameter(
      token0.address,
      token1.address,
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
          token1.address,
          rewardToken.address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<RewardLiquidityPool>(
      "RewardLiquidityPool",
      poolAddress
    );

    await token0
      .connect(airdropDistributor)
      .approve(poolAddress, ethers.constants.MaxUint256);
    await token1
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
   * |-----------------------|
   * | SWAP FEE     : 2000   |
   * | TICK SPACING :   40   |
   * | GOV FEE      :  50%   |
   * | AIRDROP0     : 10 ETH |
   * | AIRDROP1     : 20 ETH |
   * |-----------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * Liquidity Provider
   *                                |<------------LP1---------->|
   *                        |<---LP2--->|                   |<---LP3--->|
   *        |<---LP4--->|                                                   |<---LP5--->|
   * test 1)                                |<------|
   * test 2)                          |<------------|
   * test 3)        |<------------------------------|
   * test 4)                                        |-->|
   * test 5)                                        |------------->|
   * test 6)                                        |---------------------------->|
   */
  describe("# FEE DISTRIBUTION AFTER SWAP CASE With airdrop", async () => {
    let lp1: LPInfo;
    let lp2: LPInfo;
    let lp3: LPInfo;
    let lp4: LPInfo;
    let lp5: LPInfo;

    let startTime: number;
    let period = 3600 * 24 * 7;
    let airdrop0 = ethers.utils.parseEther("0.0001");
    let airdrop1 = ethers.utils.parseEther("0.0002");

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

      startTime = (await ethers.provider.getBlock("latest")).timestamp + 3600;

      await pool
        .connect(airdropDistributor)
        .depositAirdrop(airdrop0, airdrop1, startTime, period);
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 1)                                |<------|
     */
    it("TEST 1)", async () => {
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
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lpFees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const originalOutput = await getDy(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );
      const expectedSwapFee = calculateSwapFee(originalOutput);
      const expectedAirdrop0 = airdrop0;
      const expectedAirdrop1 = airdrop1;

      expect(withInPrecision(expectedAirdrop0, lpFees.token0Amount, 4)).to.be
        .true;
      expect(
        withInPrecision(
          expectedSwapFee.add(expectedAirdrop1),
          lpFees.token1Amount,
          4
        )
      ).to.be.true;
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 2)                          |<------------|
     */
    it("TEST 2)", async () => {
      // GIVEN
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-3 * TICK_SPACING),
        await getPriceAtTick(0),
        true
      );
      const span1 = await getDx(
        lp1.liquidity.add(lp2.liquidity),
        await getPriceAtTick(-3.5 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1);

      // WHEN
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp2Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp2.positionId, liquidityProvider.address, false);

      // THEN
      const lp1Out = await getDy(
        lp1.liquidity,
        await getPriceAtTick(-3.5 * TICK_SPACING),
        await getPriceAtTick(0),

        true
      );
      const lp2Out = await getDy(
        lp2.liquidity,
        await getPriceAtTick(-3.5 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),

        true
      );
      const expectedlp1Fee = calculateSwapFee(lp1Out);
      const expectedlp2Fee = calculateSwapFee(lp2Out);

      const time0 = ts - startTime;
      const time1 = startTime + period - ts;
      const expectedlp1Airdrop0 = airdrop0
        .mul(time0)
        .div(period)
        .add(
          airdrop0
            .mul(time1)
            .div(period)
            .mul(lp1.liquidity)
            .div(lp1.liquidity.add(lp2.liquidity))
        );
      const expectedlp1Airdrop1 = airdrop1
        .mul(time0)
        .div(period)
        .add(
          airdrop1
            .mul(time1)
            .div(period)
            .mul(lp1.liquidity)
            .div(lp1.liquidity.add(lp2.liquidity))
        );
      const expectedlp2Airdrop0 = airdrop0
        .mul(time1)
        .div(period)
        .mul(lp2.liquidity)
        .div(lp1.liquidity.add(lp2.liquidity));
      const expectedlp2Airdrop1 = airdrop1
        .mul(time1)
        .div(period)
        .mul(lp2.liquidity)
        .div(lp1.liquidity.add(lp2.liquidity));

      expect(withInPrecision(expectedlp1Airdrop0, lp1Fees.token0Amount, 4)).to
        .be.true;
      expect(
        withInPrecision(
          expectedlp1Airdrop1.add(expectedlp1Fee),
          lp1Fees.token1Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedlp2Airdrop0, lp2Fees.token0Amount, 4)).to
        .be.true;
      expect(
        withInPrecision(
          expectedlp2Airdrop1.add(expectedlp2Fee),
          lp2Fees.token1Amount,
          4
        )
      ).to.be.true;
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 3)        |<------------------------------|
     */
    it("TEST 3)", async () => {
      // GIVEN
      const span0 = await getDx(
        lp1.liquidity,
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(0),
        true
      );
      const span1 = await getDx(
        lp2.liquidity,
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const span2 = await getDx(
        lp4.liquidity,
        await getPriceAtTick(-8 * TICK_SPACING),
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2);

      // WHEN
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp2Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp2.positionId, liquidityProvider.address, false);
      const lp4Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp4.positionId, liquidityProvider.address, false);

      // THEN
      const lp1Out = await getDy(
        lp1.liquidity,
        await getPriceAtTick(-4 * TICK_SPACING),
        await getPriceAtTick(0),
        true
      );
      const lp2Out = await getDy(
        lp2.liquidity,
        await getPriceAtTick(-6 * TICK_SPACING),
        await getPriceAtTick(-3 * TICK_SPACING),
        true
      );
      const lp4Out = await getDy(
        lp4.liquidity,
        await getPriceAtTick(-8 * TICK_SPACING),
        await getPriceAtTick(-7 * TICK_SPACING),
        true
      );
      const expectedlp1Fee = calculateSwapFee(lp1Out);
      const expectedlp2Fee = calculateSwapFee(lp2Out);
      const expectedlp4Fee = calculateSwapFee(lp4Out);

      const time0 = ts - startTime;
      const time1 = startTime + period - ts;
      const expectedlp1Airdrop0 = airdrop0.mul(time0).div(period);
      const expectedlp1Airdrop1 = airdrop1.mul(time0).div(period);
      const expectedlp4Airdrop0 = airdrop0.mul(time1).div(period);
      const expectedlp4Airdrop1 = airdrop1.mul(time1).div(period);

      expect(withInPrecision(expectedlp1Airdrop0, lp1Fees.token0Amount, 4)).to
        .be.true;
      expect(
        withInPrecision(
          expectedlp1Airdrop1.add(expectedlp1Fee),
          lp1Fees.token1Amount,
          4
        )
      ).to.be.true;
      expect(lp2Fees.token0Amount).to.be.eq(BigNumber.from(0));
      expect(withInPrecision(expectedlp2Fee, lp2Fees.token1Amount, 4)).to.be
        .true;
      expect(withInPrecision(expectedlp4Airdrop0, lp4Fees.token0Amount, 4)).to
        .be.true;
      expect(
        withInPrecision(
          expectedlp4Airdrop1.add(expectedlp4Fee),
          lp4Fees.token1Amount,
          4
        )
      ).to.be.true;
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 4)                                        |-->|
     */
    it("TEST 4)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(1 * TICK_SPACING);
      const inputAmount = await getDy(
        lp1.liquidity,
        currentPrice,
        targetPrice,
        true
      );

      // WHEN
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lpFees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const originalOutput = await getDx(
        lp1.liquidity,
        currentPrice,
        targetPrice,
        true
      );
      const expectedSwapFee = calculateSwapFee(originalOutput);
      const expectedAirdrop0 = airdrop0;
      const expectedAirdrop1 = airdrop1;

      expect(
        withInPrecision(
          expectedAirdrop0.add(expectedSwapFee),
          lpFees.token0Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedAirdrop1, lpFees.token1Amount, 4)).to.be
        .true;
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 2)                                        |-------->|
     */
    it("TEST 5)", async () => {
      // GIVEN
      const span0 = await getDy(
        lp1.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(2.5 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp3.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(2.5 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1);

      // WHEN
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp3Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp3.positionId, liquidityProvider.address, false);

      // THEN
      const lp1Out = await getDx(
        lp1.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(2.5 * TICK_SPACING),
        true
      );
      const lp3Out = await getDx(
        lp3.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(2.5 * TICK_SPACING),
        true
      );
      const expectedlp1Fee = calculateSwapFee(lp1Out);
      const expectedlp3Fee = calculateSwapFee(lp3Out);

      const time0 = ts - startTime;
      const time1 = startTime + period - ts;
      const expectedlp1Airdrop0 = airdrop0
        .mul(time0)
        .div(period)
        .add(
          airdrop0
            .mul(time1)
            .div(period)
            .mul(lp1.liquidity)
            .div(lp1.liquidity.add(lp3.liquidity))
        );
      const expectedlp1Airdrop1 = airdrop1
        .mul(time0)
        .div(period)
        .add(
          airdrop1
            .mul(time1)
            .div(period)
            .mul(lp1.liquidity)
            .div(lp1.liquidity.add(lp3.liquidity))
        );
      const expectedlp3Airdrop0 = airdrop0
        .mul(time1)
        .div(period)
        .mul(lp3.liquidity)
        .div(lp1.liquidity.add(lp3.liquidity));
      const expectedlp3Airdrop1 = airdrop1
        .mul(time1)
        .div(period)
        .mul(lp3.liquidity)
        .div(lp1.liquidity.add(lp3.liquidity));

      expect(
        withInPrecision(
          expectedlp1Airdrop0.add(expectedlp1Fee),
          lp1Fees.token0Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedlp1Airdrop1, lp1Fees.token1Amount, 4)).to
        .be.true;
      expect(
        withInPrecision(
          expectedlp3Airdrop0.add(expectedlp3Fee),
          lp3Fees.token0Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedlp3Airdrop1, lp3Fees.token1Amount, 4)).to
        .be.true;
    });

    /*
     *                                         CURRENT PRICE
     *                                                |
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *        |<---LP4--->|           |<------------LP1---------->|           |<---LP5--->|
     *                        |<---LP2--->|                   |<---LP3--->|
     * test 3)                                        |------------------------------>|
     */
    it("TEST 6)", async () => {
      // GIVEN
      const span0 = await getDy(
        lp1.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const span1 = await getDy(
        lp3.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const span2 = await getDy(
        lp5.liquidity,
        await getPriceAtTick(6 * TICK_SPACING),
        await getPriceAtTick(8 * TICK_SPACING),
        true
      );
      const inputAmount = span0.add(span1).add(span2);

      // WHEN
      await clearBalance();
      await setNextTimeStamp(startTime + period / 2);
      await swapToken1ToToken0(inputAmount, BigNumber.from(0));
      const ts = (await ethers.provider.getBlock("latest")).timestamp;
      await setNextTimeStamp(startTime + period);
      await clearLPBalance();
      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp3Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp3.positionId, liquidityProvider.address, false);
      const lp5Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp5.positionId, liquidityProvider.address, false);

      // THEN
      const lp1Out = await getDx(
        lp1.liquidity,
        await getPriceAtTick(0),
        await getPriceAtTick(3 * TICK_SPACING),
        true
      );
      const lp3Out = await getDx(
        lp3.liquidity,
        await getPriceAtTick(2 * TICK_SPACING),
        await getPriceAtTick(5 * TICK_SPACING),
        true
      );
      const lp5Out = await getDx(
        lp5.liquidity,
        await getPriceAtTick(6 * TICK_SPACING),
        await getPriceAtTick(8 * TICK_SPACING),
        true
      );
      const expectedlp1Fee = calculateSwapFee(lp1Out);
      const expectedlp3Fee = calculateSwapFee(lp3Out);
      const expectedlp5Fee = calculateSwapFee(lp5Out);

      const time0 = ts - startTime;
      const time1 = startTime + period - ts;
      const expectedlp1Airdrop0 = airdrop0.mul(time0).div(period);
      const expectedlp1Airdrop1 = airdrop1.mul(time0).div(period);
      const expectedlp5Airdrop0 = airdrop0.mul(time1).div(period);
      const expectedlp5Airdrop1 = airdrop1.mul(time1).div(period);

      expect(
        withInPrecision(
          expectedlp1Airdrop0.add(expectedlp1Fee),
          lp1Fees.token0Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedlp1Airdrop1, lp1Fees.token1Amount, 4)).to
        .be.true;
      expect(withInPrecision(expectedlp3Fee, lp3Fees.token0Amount, 4)).to.be
        .true;
      expect(lp3Fees.token1Amount).to.be.eq(BigNumber.from(0));
      expect(
        withInPrecision(
          expectedlp5Airdrop0.add(expectedlp5Fee),
          lp5Fees.token0Amount,
          4
        )
      ).to.be.true;
      expect(withInPrecision(expectedlp5Airdrop1, lp5Fees.token1Amount, 4)).to
        .be.true;
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

  describe("# FEE DISTRIBUTION AFTER ADDITIONAL MINTING LIQUIDITY CASE", async () => {
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
