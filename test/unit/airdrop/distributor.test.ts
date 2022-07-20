import { ethers, network } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import {
  ERC20Test,
  WETH10,
  ConcentratedLiquidityPool,
  MasterDeployer,
  AirdropDistributor,
} from "../../../types";
import chai, { expect } from "chai";
import { describe } from "mocha";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "hardhat-deploy-ethers/signers";
chai.use(smock.matchers);

describe("AirdropDistributor", async () => {
  let _snapshotId: string;
  let snapshotId: string;
  let DAY = 3600 * 24;
  let WEEK = DAY * 7;

  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;

  let airdropDistributor: AirdropDistributor;
  let wklay: WETH10;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let token2: ERC20Test;
  let masterDeployer: FakeContract<MasterDeployer>;
  let pool0: FakeContract<ConcentratedLiquidityPool>;
  let pool1: FakeContract<ConcentratedLiquidityPool>;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, trader] = await ethers.getSigners();

    // ======== FACTORY ==========
    const AirdropDistributor = await ethers.getContractFactory(
      "AirdropDistributor"
    );
    airdropDistributor =
      (await AirdropDistributor.deploy()) as AirdropDistributor;

    // ======== FAKE CONTRACTS ========
    masterDeployer = await smock.fake<MasterDeployer>("MasterDeployer");
    wklay = (await (
      await ethers.getContractFactory("WETH10")
    ).deploy()) as WETH10;
    pool0 = await smock.fake<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool"
    );
    pool1 = await smock.fake<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool"
    );

    // ======== MOCK TOKENS ========
    token0 = (await (
      await ethers.getContractFactory("ERC20Test")
    ).deploy("tokenA", "TA", 18)) as ERC20Test;
    token1 = (await (
      await ethers.getContractFactory("ERC20Test")
    ).deploy("tokenB", "TB", 18)) as ERC20Test;
    token2 = (await (
      await ethers.getContractFactory("ERC20Test")
    ).deploy("tokenC", "TC", 18)) as ERC20Test;

    await airdropDistributor.initialize(masterDeployer.address, wklay.address);

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

  describe("# DEPOSIT & AIRDROP SCENARIO", async () => {
    let epochStartTime: number;
    let epochEndTime: number;
    let period: number;
    let airdropAmount = ethers.utils.parseEther("10");

    beforeEach("setup", async () => {
      epochStartTime =
        Math.floor(
          (await ethers.provider.getBlock("latest")).timestamp / WEEK
        ) *
          WEEK +
        WEEK;
      period = WEEK;

      epochEndTime = epochStartTime + WEEK;

      masterDeployer.airdropDistributor.returns(airdropDistributor.address);

      await setNextTimeStamp(epochStartTime);

      pool0.token0.returns(token0.address);
      pool0.token1.returns(token1.address);
      pool1.token0.returns(token2.address);
      pool1.token1.returns(token1.address);

      await token0.mint(deployer.address, airdropAmount.mul(10));
      await token1.mint(deployer.address, airdropAmount.mul(10));
      await token2.mint(deployer.address, airdropAmount.mul(10));
      await token0
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
      await token1
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
      await token2
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
    });

    it("revert case) not pool", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(false);

      // THEN
      await expect(
        airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token0.address, airdropAmount)
      ).to.be.revertedWith("NotExists");
    });

    it("revert case) airdrop token is not one of the pair tokens in pool", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);

      // THEN
      await expect(
        airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token2.address, airdropAmount)
      ).to.be.revertedWith("NotPoolToken");
    });

    it("DEPOSIT token0", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);
      expect(info.amount0).to.be.eq(airdropAmount);
      expect(info.amount1).to.be.eq(0);
      expect(info.startTime).to.be.eq(epochEndTime);
      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(1);
    });

    it("DEPOSIT token0 twice at same epoch", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);
      expect(info.amount0).to.be.eq(airdropAmount.mul(2));
      expect(info.amount1).to.be.eq(0);
      expect(info.startTime).to.be.eq(epochEndTime);
    });

    it("DEPOSIT token0 twice at each epoch", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);

      // WHEN
      await setNextTimeStamp(epochEndTime);

      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token1.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);
      expect(info.amount0).to.be.eq(0);
      expect(info.amount1).to.be.eq(airdropAmount);
      expect(info.startTime).to.be.eq(epochEndTime + period);
      expect(pool0.depositAirdrop).to.be.calledWith(
        BigNumber.from(airdropAmount),
        BigNumber.from(0),
        BigNumber.from(epochEndTime),
        BigNumber.from(period)
      );

      const snapshot0 = await airdropDistributor.airdropSnapshot(
        pool0.address,
        0
      );
      expect(snapshot0.amount0).to.be.eq(airdropAmount);
      expect(snapshot0.amount1).to.be.eq(0);
      expect(snapshot0.startTime).to.be.eq(epochEndTime);
    });

    it("DEPOSIT token0 and token1 at same epoch", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token1.address, airdropAmount.mul(2));

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);
      expect(info.amount0).to.be.eq(airdropAmount);
      expect(info.amount1).to.be.eq(airdropAmount.mul(2));
      expect(info.startTime).to.be.eq(epochEndTime);
    });

    it("deposit klay", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);
      pool0.token0.returns(wklay.address);

      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositKlay(pool0.address, { value: airdropAmount });

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);
      expect(info.amount0).to.be.eq(airdropAmount);
      expect(info.amount1).to.be.eq(0);
      expect(info.startTime).to.be.eq(epochEndTime);
    });

    it("revert case) airdropStartTimePerPool[pool] > epochStartTime()", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      await expect(
        airdropDistributor.connect(deployer).airdrop(pool0.address)
      ).to.be.revertedWith("NotYet");
    });

    it("airdrop token0 and token1", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token1.address, airdropAmount.mul(2));

      // WHEN
      await setNextTimeStamp(epochEndTime + 100);
      await airdropDistributor.connect(deployer).airdrop(pool0.address);

      // THEN
      expect(pool0.depositAirdrop).to.be.calledWith(
        BigNumber.from(airdropAmount),
        BigNumber.from(airdropAmount.mul(2)),
        BigNumber.from(epochStartTime + period),
        BigNumber.from(period)
      );
    });

    it("airdropAll", async () => {
      // GIVEN
      masterDeployer.pools.whenCalledWith(pool0.address).returns(true);
      masterDeployer.pools.whenCalledWith(pool1.address).returns(true);

      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool1.address, token1.address, airdropAmount.mul(2));

      // WHEN
      await setNextTimeStamp(epochEndTime + 100);
      await airdropDistributor.connect(deployer).airdropAll();

      // THEN
      expect(pool0.depositAirdrop).to.be.calledWith(
        BigNumber.from(airdropAmount),
        BigNumber.from(0),
        BigNumber.from(epochStartTime + period),
        BigNumber.from(period)
      );
      expect(pool1.depositAirdrop).to.be.calledWith(
        BigNumber.from(0),
        BigNumber.from(airdropAmount.mul(2)),
        BigNumber.from(epochStartTime + period),
        BigNumber.from(period)
      );

      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(2);
      expect(
        await airdropDistributor.airdropSnapshotLength(pool0.address)
      ).to.be.eq(1);
      expect(
        await airdropDistributor.airdropSnapshotLength(pool1.address)
      ).to.be.eq(1);
    });
  });
});
