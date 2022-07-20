import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolManager,
  PoolRouter,
  ERC20Test,
  MasterDeployer,
  AirdropDistributor,
} from "../../types";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { sortTokens } from "../harness/utils";
import { Pangea } from "../harness/pangea";
import { encodeCreatePoolData } from "../harness/helpers";
import { expect } from "chai";

describe("SCENARIO:DISTRIBUTE", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const TWO_POW_128 = BigNumber.from(2).pow(128);
  const SWAP_FEE = 0;
  const TICK_SPACING = 40;
  const DAY = 3600 * 24;
  const WEEK = DAY * 7;
  const DUST_VALUE_LIMIT = 10;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let airdrop: SignerWithAddress;

  let pangea: Pangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: ConcentratedLiquidityPoolFactory;
  let poolManager: ConcentratedLiquidityPoolManager;
  let airdropDistributor: AirdropDistributor;
  let pool: ConcentratedLiquidityPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, airdrop] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await Pangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.concentratedPoolFactory;
    poolManager = pangea.concentratedPoolManager;
    airdropDistributor = pangea.airdropDistributor;
    router = pangea.router;

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
    await masterDeployer.setAirdropDistributor(airdropDistributor.address);

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool",
      poolAddress
    );

    await token0.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token0
      .connect(airdrop)
      .approve(airdropDistributor.address, ethers.constants.MaxUint256);
    await token1.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token1
      .connect(airdrop)
      .approve(airdropDistributor.address, ethers.constants.MaxUint256);

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
    await token1.burnAll(liquidityProvider.address);
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

  async function removeAll(positionId: BigNumberish) {
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

  describe("# DISTRIBUTION EDGE CASE", async () => {
    let lp: LPInfo;

    beforeEach("create position", async () => {
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("[1] NO Liquidity In pool", async () => {
      /// GIVEN
      await removeAll(lp.positionId);
      const epochStartTime = (
        await airdropDistributor.nextEpochStartTime()
      ).toNumber();
      const amount0 = ethers.utils.parseEther("10");
      const amount1 = ethers.utils.parseEther("20");

      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);

      /// WHEN
      await setNextTimeStamp(epochStartTime);
      await airdropDistributor.airdropAll();

      // THEN
      expect(await pool.airdrop0PerSecond()).to.be.eq(
        amount0.mul(TWO_POW_128).div(WEEK)
      );
      expect(await pool.airdrop1PerSecond()).to.be.eq(
        amount1.mul(TWO_POW_128).div(WEEK)
      );
    });

    it("[2] NO Liquidity In pool but airdrop twice", async () => {
      /// GIVEN
      await removeAll(lp.positionId);
      const epochStartTime = (
        await airdropDistributor.nextEpochStartTime()
      ).toNumber();
      const amount0 = ethers.utils.parseEther("10");
      const amount1 = ethers.utils.parseEther("20");

      /// WHEN
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime);
      await airdropDistributor.airdropAll();

      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime + WEEK);
      await airdropDistributor.airdropAll();

      // THEN
      const remain0 = amount0
        .mul(TWO_POW_128)
        .div(WEEK)
        .mul(WEEK)
        .div(TWO_POW_128);
      const remain1 = amount1
        .mul(TWO_POW_128)
        .div(WEEK)
        .mul(WEEK)
        .div(TWO_POW_128);

      expect(await pool.airdrop0PerSecond()).to.be.eq(
        remain0.add(amount0).mul(TWO_POW_128).div(WEEK)
      );
      expect(await pool.airdrop1PerSecond()).to.be.eq(
        remain1.add(amount1).mul(TWO_POW_128).div(WEEK)
      );
    });

    it("[3] Liquidity Exists but no swap transaction", async () => {
      /// GIVEN
      const epochStartTime = (
        await airdropDistributor.nextEpochStartTime()
      ).toNumber();
      const amount0 = ethers.utils.parseEther("10");
      const amount1 = ethers.utils.parseEther("20");

      /// WHEN
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime);
      await airdropDistributor.airdropAll();

      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime + WEEK);
      await airdropDistributor.airdropAll();

      // THEN
      expect(await pool.airdrop0PerSecond()).to.be.eq(
        amount0.mul(TWO_POW_128).div(WEEK)
      );
      expect(await pool.airdrop1PerSecond()).to.be.eq(
        amount1.mul(TWO_POW_128).div(WEEK)
      );

      const positionFee = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp.positionId);
      expect(amount0.sub(positionFee.token0amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      ); // DUST_VALUE
      expect(amount1.sub(positionFee.token1amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      ); // DUST_VALUE
    });

    it("[4] Liquidity Exists but no swap transaction and lazy airdrop", async () => {
      /// GIVEN
      const epochStartTime = (
        await airdropDistributor.nextEpochStartTime()
      ).toNumber();
      const amount0 = ethers.utils.parseEther("10");
      const amount1 = ethers.utils.parseEther("20");

      /// WHEN
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime);
      await airdropDistributor.airdropAll();

      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token0.address, amount0);
      await airdropDistributor
        .connect(airdrop)
        .depositToken(pool.address, token1.address, amount1);
      await setNextTimeStamp(epochStartTime + WEEK + 2 * DAY);
      await airdropDistributor.airdropAll();

      // THEN
      expect(await pool.airdrop0PerSecond()).to.be.eq(
        amount0.mul(TWO_POW_128).div(WEEK)
      );
      expect(await pool.airdrop1PerSecond()).to.be.eq(
        amount1.mul(TWO_POW_128).div(WEEK)
      );

      const positionFee = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp.positionId);
      expect(amount0.sub(positionFee.token0amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      ); // DUST_VALUE
      expect(amount1.sub(positionFee.token1amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      ); // DUST_VALUE
    });
  });
});

interface LPInfo {
  positionId: BigNumber;
  liquidity: BigNumber;
  token0: BigNumber;
  token1: BigNumber;
}
