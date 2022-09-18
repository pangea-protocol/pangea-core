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
    await masterDeployer.setAirdropDistributor(airdrop.address);

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<MiningPool>("MiningPool", poolAddress);

    await token0.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token0
      .connect(airdrop)
      .approve(poolAddress, ethers.constants.MaxUint256);
    await token1.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await token1
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

  describe("# depositAirdropAndReward", async () => {
    let lp: LPInfo;

    beforeEach("create position", async () => {
      lp = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance();
    });

    it("REVERT CASE) startTime + period <= block.timestamp", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp - 2 * WEEK;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");

      // THEN
      await expect(
        pool
          .connect(airdrop)
          .depositAirdropAndReward(
            givenAirdrop0,
            givenAirdrop1,
            0,
            givenAirdropStartTime,
            givenAirdropPeriod
          )
      ).to.be.reverted;
    });

    it("REVERT CASE) startTime < airdropStartTime + airdropPeriod", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");

      // WHEN
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // THEN
      await expect(
        pool
          .connect(airdrop)
          .depositAirdropAndReward(
            givenAirdrop0,
            givenAirdrop1,
            0,
            givenAirdropStartTime + givenAirdropPeriod - 1,
            givenAirdropPeriod
          )
      ).to.be.reverted;
    });

    it("REVERT CASE) anonymous user try to deposit", async () => {
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");

      // WHEN
      await expect(
        pool
          .connect(trader)
          .depositAirdropAndReward(
            givenAirdrop0,
            givenAirdrop1,
            0,
            givenAirdropStartTime,
            givenAirdropPeriod
          )
      ).to.be.revertedWith("NotAuthorized");
    });

    it("airdrop0PerSecond & airdrop1PerSecond value check", async () => {
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("10");
      const givenAirdrop1 = ethers.utils.parseEther("20");

      // WHEN
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // THEN
      expect(await pool.airdropStartTime()).to.be.eq(givenAirdropStartTime);
      expect(await pool.airdropPeriod()).to.be.eq(givenAirdropPeriod);
      const Q128 = BigNumber.from(2).pow(128);
      expect(await pool.airdrop0PerSecond()).to.be.eq(
        givenAirdrop0.mul(Q128).div(WEEK)
      );
      expect(await pool.airdrop1PerSecond()).to.be.eq(
        givenAirdrop1.mul(Q128).div(WEEK)
      );
    });

    it("airdrop0PerSecond & airdrop1PerSecond all will be 0 if airdrop0, airdrop1 is 0 ", async () => {
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("10");
      const givenAirdrop1 = ethers.utils.parseEther("20");

      // WHEN
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod + 1);
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          0,
          givenAirdropStartTime + givenAirdropPeriod,
          givenAirdropPeriod
        );

      // THEN
      expect(await pool.airdrop0PerSecond()).to.be.eq(0);
      expect(await pool.airdrop1PerSecond()).to.be.eq(0);
    });
  });

  describe("# FEE GROWTH GLOBAL TEST", async () => {
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

    it("TEST 1) Airdrop But No Liquidity", async () => {
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
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + 3600);

      // THEN
      expect(await pool.feeGrowthGlobal0()).to.be.eq(BigNumber.from(0));
      expect(await pool.feeGrowthGlobal1()).to.be.eq(BigNumber.from(0));
    });

    it("TEST 2) Airdrop Token0 & Token1 and time goes on...", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + 3600);
      const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

      // THEN
      const allocatedAirdrop0 = (await pool.airdrop0PerSecond()).mul(
        timestamp - givenAirdropStartTime
      );
      const allocatedAirdrop1 = (await pool.airdrop1PerSecond()).mul(
        timestamp - givenAirdropStartTime
      );
      const liquidity = await pool.liquidity();
      expect(await pool.feeGrowthGlobal0()).to.be.eq(
        allocatedAirdrop0.div(liquidity)
      );
      expect(await pool.feeGrowthGlobal1()).to.be.eq(
        allocatedAirdrop1.div(liquidity)
      );
    });
  });

  describe("# FEE DISTRIBUTION WITH AIRDROP (NO SWAP)", async () => {
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
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime - 30);
      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      expect(lp1Fees.token0Amount).to.be.eq(BigNumber.from(0));
      expect(lp1Fees.token1Amount).to.be.eq(BigNumber.from(0));
    });

    it("TEST 2) block.timestamp > airdropStartTime + period ==> all airdrop is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);
      expect(givenAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(givenAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 3) double claim : block.timestamp > airdropStartTime + period ==> all airdrop is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await clearLPBalance();
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);
      expect(givenAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(givenAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 4) half claim : block.timestamp = airdropStartTime + period/2 ==> half airdrop is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await clearLPBalance();

      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      const tx = await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      const receipt = await tx.wait();
      const timestamp = (await ethers.provider.getBlock(receipt.blockNumber))
        .timestamp;

      // THEN
      const allocatedAirdrop0 = givenAirdrop0
        .mul(timestamp - givenAirdropStartTime)
        .div(WEEK);
      const allocatedAirdrop1 = givenAirdrop1
        .mul(timestamp - givenAirdropStartTime)
        .div(WEEK);

      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);

      expect(allocatedAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(allocatedAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 5) claim twice: block.timestamp > airdropStartTime + period ==> all airdrop is distributed", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // WHEN
      await clearLPBalance();
      await setNextTimeStamp(givenAirdropStartTime + WEEK / 2);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await setNextTimeStamp(givenAirdropStartTime + WEEK);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const allocatedAirdrop0 = givenAirdrop0;
      const allocatedAirdrop1 = givenAirdrop1;

      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);

      expect(allocatedAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(allocatedAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 6) claim after burn check", async () => {
      // BURN AFTER CLAIM
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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
        .collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const allocatedAirdrop0 = givenAirdrop0;
      const allocatedAirdrop1 = givenAirdrop1;

      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);

      expect(allocatedAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(allocatedAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 7) claim after mint check", async () => {
      // MINT AFTER CLAIM
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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
        .collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      const allocatedAirdrop0 = givenAirdrop0;
      const allocatedAirdrop1 = givenAirdrop1;

      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);

      expect(allocatedAirdrop0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(allocatedAirdrop1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 7) burn all liquidity", async () => {
      // MINT AFTER CLAIM
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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
      const expectedAmount0 = lp1.token0.add(givenAirdrop0);
      const expectedAmount1 = lp1.token1.add(givenAirdrop1);

      const token0Balance = await token0.balanceOf(liquidityProvider.address);
      const token1Balance = await token1.balanceOf(liquidityProvider.address);

      expect(expectedAmount0.sub(token0Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(expectedAmount1.sub(token1Balance))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
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
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      expect(givenAirdrop0.sub(lp1Fees.token0Amount))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(givenAirdrop1.sub(lp1Fees.token1Amount))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 2) price (0 ---> -3.5)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp2Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp2.positionId, liquidityProvider.address, false);

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const totalLiquidity = lp1.liquidity.add(lp2.liquidity);

      const expectedLp1Fee0 = givenAirdrop0
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenAirdrop0
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp1Fee1 = givenAirdrop1
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenAirdrop1
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp2Fee0 = givenAirdrop0
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp2.liquidity)
        .div(totalLiquidity);
      const expectedLp2Fee1 = givenAirdrop1
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp2.liquidity)
        .div(totalLiquidity);

      expect(expectedLp1Fee0.sub(lp1Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp1Fee1.sub(lp1Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp2Fee0.sub(lp2Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp2Fee1.sub(lp2Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 3) price (0 ---> -5)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp2Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp2.positionId, liquidityProvider.address, false);

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const expectedLp1Fee0 = givenAirdrop0
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp1Fee1 = givenAirdrop1
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp2Fee0 = givenAirdrop0
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);
      const expectedLp2Fee1 = givenAirdrop1
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);

      expect(expectedLp1Fee0.sub(lp1Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp1Fee1.sub(lp1Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp2Fee0.sub(lp2Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp2Fee1.sub(lp2Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 4) price (0 ---> 1)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);

      // THEN
      expect(givenAirdrop0.sub(lp1Fees.token0Amount))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
      expect(givenAirdrop1.sub(lp1Fees.token1Amount))
        .to.be.lte(DUST_VALUE_LIMIT)
        .gte(0);
    });

    it("TEST 5) price (0 ---> 3)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp3Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp3.positionId, liquidityProvider.address, false);

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;
      const totalLiquidity = lp1.liquidity.add(lp3.liquidity);

      const expectedLp1Fee0 = givenAirdrop0
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenAirdrop0
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp1Fee1 = givenAirdrop1
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod)
        .add(
          givenAirdrop1
            .mul(givenAirdropEndTime - swapTs)
            .div(givenAirdropPeriod)
            .mul(lp1.liquidity)
            .div(totalLiquidity)
        );
      const expectedLp3Fee0 = givenAirdrop0
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp3.liquidity)
        .div(totalLiquidity);
      const expectedLp3Fee1 = givenAirdrop1
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod)
        .mul(lp3.liquidity)
        .div(totalLiquidity);

      expect(expectedLp1Fee0.sub(lp1Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp1Fee1.sub(lp1Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Fee0.sub(lp3Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Fee1.sub(lp3Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
    });

    it("TEST 6) price (0 ---> 6)", async () => {
      // GIVEN
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenAirdrop0 = ethers.utils.parseEther("12");
      const givenAirdrop1 = ethers.utils.parseEther("34");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          givenAirdrop0,
          givenAirdrop1,
          0,
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

      const lp1Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp1.positionId, liquidityProvider.address, false);
      const lp3Fees = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(lp3.positionId, liquidityProvider.address, false);

      // THEN
      const givenAirdropEndTime = givenAirdropStartTime + givenAirdropPeriod;

      const expectedLp1Fee0 = givenAirdrop0
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp1Fee1 = givenAirdrop1
        .mul(swapTs - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const expectedLp3Fee0 = givenAirdrop0
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);
      const expectedLp3Fee1 = givenAirdrop1
        .mul(givenAirdropEndTime - swapTs)
        .div(givenAirdropPeriod);

      expect(expectedLp1Fee0.sub(lp1Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp1Fee1.sub(lp1Fees.token1Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Fee0.sub(lp3Fees.token0Amount).abs()).to.be.lte(
        DUST_VALUE_LIMIT
      );
      expect(expectedLp3Fee1.sub(lp3Fees.token1Amount).abs()).to.be.lte(
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
