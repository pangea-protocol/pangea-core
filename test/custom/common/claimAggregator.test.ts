import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  PoolRouter,
  ERC20Test,
  MasterDeployer,
  ClaimAggregator,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getDy, getPriceAtTick, sortTokens } from "../../harness/utils";
import { expect } from "chai";
import { encodeCreatePoolData } from "../../harness/helpers";
import { Pangea } from "../../harness/pangea";

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
describe("CLAIM AGGREGATOR", function () {
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

  let pangea: Pangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: ConcentratedLiquidityPoolFactory;
  let poolManager: ConcentratedLiquidityPoolManager;
  let pool: ConcentratedLiquidityPool;
  let claimAggregator: ClaimAggregator;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdropDistributor] =
      await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await Pangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.concentratedPoolFactory;
    poolManager = pangea.concentratedPoolManager;
    router = pangea.router;

    await masterDeployer.setAirdropDistributor(airdropDistributor.address);

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    claimAggregator = (await (
      await ethers.getContractFactory("ClaimAggregator")
    ).deploy()) as ClaimAggregator;

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
      .connect(airdropDistributor)
      .approve(poolAddress, ethers.constants.MaxUint256);
    await token1
      .connect(airdropDistributor)
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
    let lp: LPInfo;

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
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *                                |<------------LP----------->|
     * test 1)                                |<------|
     */
    it("TEST 1)", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        lp.liquidity,
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
        .setApprovalForAll(claimAggregator.address, true);
      await claimAggregator
        .connect(liquidityProvider)
        .collect(
          poolManager.address,
          lp.positionId,
          liquidityProvider.address,
          false
        );

      // THEN
      const originalOutput = await getDy(
        lp.liquidity,
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
     *                                |<------------LP----------->|
     * test 1)                                |<------|
     */
    it("TEST 2) REVERT without setApproval", async () => {
      // GIVEN
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-2 * TICK_SPACING);
      const inputAmount = await getDx(
        lp.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // WHEN
      await clearBalance();
      await swapToken0ToToken1(inputAmount, BigNumber.from(0));
      await clearLPBalance();

      // THEN
      await expect(
        claimAggregator
          .connect(liquidityProvider)
          .collect(
            poolManager.address,
            lp.positionId,
            liquidityProvider.address,
            false
          )
      ).to.be.reverted;
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
