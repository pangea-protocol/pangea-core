import { ethers, network } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import {
  ERC20Test,
  WETH10,
  ConcentratedLiquidityPool,
  MasterDeployer,
  MiningPool,
  AirdropDistributorV2,
  ConcentratedLiquidityPoolFactory,
  MiningPoolFactory,
} from "../../../types";
import chai, { expect } from "chai";
import { describe } from "mocha";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "hardhat-deploy-ethers/signers";
import {MiningPangea} from "../../custom/miningPool/MiningPangea";
import {sortTokens} from "../../harness/utils";
import poolFactory from "../../../deploy/PoolFactory";
chai.use(smock.matchers);

describe.only("AirdropDistributorV2", async () => {
  let _snapshotId: string;
  let snapshotId: string;
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  let DAY = 3600 * 24;
  let WEEK = DAY * 7;
  const SWAP_FEE = 2000;
  const TICK_SPACING = 20;


  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;

  let pangea: MiningPangea;

  let airdropDistributor: AirdropDistributorV2;
  let wklay: WETH10;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let token2: ERC20Test;
  let rewardToken: ERC20Test;
  let masterDeployer: MasterDeployer;

  let pool0: MiningPool;
  let pool1: ConcentratedLiquidityPool;

  let miningPoolFactory: MiningPoolFactory;
  let factory: ConcentratedLiquidityPoolFactory;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, trader] = await ethers.getSigners();

    // ======== FACTORY ==========
    pangea = await MiningPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    miningPoolFactory = pangea.poolFactory;
    wklay = pangea.weth;

    const AirdropDistributorV2 = await ethers.getContractFactory(
      "AirdropDistributorV2"
    );
    airdropDistributor =
      (await AirdropDistributorV2.deploy()) as AirdropDistributorV2;

    await pangea.masterDeployer.setAirdropDistributor(airdropDistributor.address);

    const Ticks = (await (await ethers.getContractFactory("Ticks")).deploy()).address;
    const PoolFactoryLib = (await (await ethers.getContractFactory("PoolFactoryLib", {
      libraries: {Ticks}
    })).deploy()).address
    const ConcentratedPoolFactory = await ethers.getContractFactory(
        "ConcentratedLiquidityPoolFactory",
        { libraries: { PoolFactoryLib } }
    );
    factory = await ConcentratedPoolFactory.deploy() as ConcentratedLiquidityPoolFactory
    await factory.initialize(masterDeployer.address, pangea.poolLogger.address);
    await masterDeployer.addToWhitelistFactory(factory.address);

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
    rewardToken = (await (
      await ethers.getContractFactory("ERC20Test")
    ).deploy("RewardToken", "RT", 18)) as ERC20Test;

    [token0, token1] = sortTokens(token0, token1);

    await miningPoolFactory.setAvailableParameter(
        token0.address,
        token1.address,
        rewardToken.address,
        BigNumber.from(SWAP_FEE),
        BigNumber.from(TICK_SPACING)
    );
    await masterDeployer.deployPool(
        miningPoolFactory.address,
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

    await masterDeployer.deployPool(
        factory.address,
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

    {
      const poolAddress = (
          await miningPoolFactory.getPools(token0.address, token1.address, 0, 1)
      )[0];
      pool0 = await ethers.getContractAt<MiningPool>("MiningPool", poolAddress);
    }

    {
      const poolAddress = (
          await factory.getPools(token0.address, token1.address, 0, 1)
      )[0];
      pool1 = await ethers.getContractAt<ConcentratedLiquidityPool>("ConcentratedLiquidityPool", poolAddress);
    }

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

  describe("# airdropTokens", async () => {
    beforeEach("setup", async () => {
    });

    it("airdropTokens of miningPool", async () => {
      const result = await airdropDistributor.airdropTokens(pool0.address);

      expect(result.length).to.be.eq(3)
      expect(result[0]).to.be.eq(token0.address)
      expect(result[1]).to.be.eq(token1.address)
      expect(result[2]).to.be.eq(rewardToken.address)
    })

    it("airdropTokens of concentratedLiquidityPool", async () => {
      const result = await airdropDistributor.airdropTokens(pool1.address);

      expect(result.length).to.be.eq(2)
      expect(result[0]).to.be.eq(token0.address)
      expect(result[1]).to.be.eq(token1.address)
    })
  })

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

      await setNextTimeStamp(epochStartTime);

      await token0.mint(deployer.address, airdropAmount.mul(10));
      await token1.mint(deployer.address, airdropAmount.mul(10));
      await token2.mint(deployer.address, airdropAmount.mul(10));
      await rewardToken.mint(deployer.address, airdropAmount.mul(10));
      await token0
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
      await token1
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
      await token2
        .connect(deployer)
        .approve(airdropDistributor.address, airdropAmount.mul(10));
      await rewardToken
          .connect(deployer)
          .approve(airdropDistributor.address, airdropAmount.mul(10));
    });

    it("revert case) not pool", async () => {
      // THEN
      await expect(
        airdropDistributor
          .connect(deployer)
          .depositToken(token0.address, token0.address, airdropAmount)
      ).to.be.revertedWith("NotExists");
    });

    it("revert case) not available tokens", async () => {
      // THEN
      await expect(
        airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token2.address, airdropAmount)
      ).to.be.revertedWith("NotAllowedToken");
    });

    it("DEPOSIT token0", async () => {
      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);

      expect(info.tokens[0]).to.be.eq(token0.address);
      expect(info.tokens[1]).to.be.eq(token1.address);
      expect(info.tokens[2]).to.be.eq(rewardToken.address);

      expect(info.amounts[0]).to.be.eq(airdropAmount);
      expect(info.amounts[1]).to.be.eq(0);
      expect(info.amounts[2]).to.be.eq(0);

      expect(info.startTime).to.be.eq(epochEndTime);
      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(1);
    });

    it("DEPOSIT token0 twice", async () => {
      // WHEN
      await airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);

      expect(info.tokens[0]).to.be.eq(token0.address);
      expect(info.tokens[1]).to.be.eq(token1.address);
      expect(info.tokens[2]).to.be.eq(rewardToken.address);

      expect(info.amounts[0]).to.be.eq(airdropAmount.mul(2));
      expect(info.amounts[1]).to.be.eq(0);
      expect(info.amounts[2]).to.be.eq(0);

      expect(info.startTime).to.be.eq(epochEndTime);
      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(1);
    });

    it("DEPOSIT token0 twice at each epoch", async () => {
      // WHEN
      await airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token0.address, airdropAmount);
      await setNextTimeStamp(epochEndTime);
      await airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, token0.address, airdropAmount);

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);

      expect(info.tokens[0]).to.be.eq(token0.address);
      expect(info.tokens[1]).to.be.eq(token1.address);
      expect(info.tokens[2]).to.be.eq(rewardToken.address);

      expect(info.amounts[0]).to.be.eq(airdropAmount);
      expect(info.amounts[1]).to.be.eq(0);
      expect(info.amounts[2]).to.be.eq(0);

      expect(info.startTime).to.be.eq(epochEndTime + WEEK);
      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(1);
    });

    it("DEPOSIT token0 and token1 and rewardToken at same epoch", async () => {
      // WHEN
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token0.address, airdropAmount);
      await airdropDistributor
        .connect(deployer)
        .depositToken(pool0.address, token1.address, airdropAmount.mul(2));
      await airdropDistributor
          .connect(deployer)
          .depositToken(pool0.address, rewardToken.address, airdropAmount.mul(3));

      // THEN
      const info = await airdropDistributor.depositedAirdrop(pool0.address);

      expect(info.tokens[0]).to.be.eq(token0.address);
      expect(info.tokens[1]).to.be.eq(token1.address);
      expect(info.tokens[2]).to.be.eq(rewardToken.address);

      expect(info.amounts[0]).to.be.eq(airdropAmount);
      expect(info.amounts[1]).to.be.eq(airdropAmount.mul(2));
      expect(info.amounts[2]).to.be.eq(airdropAmount.mul(3));

      expect(info.startTime).to.be.eq(epochEndTime);
      expect(await airdropDistributor.airdropPoolLength()).to.be.eq(1);

      await setNextTimeStamp(epochEndTime);

      await airdropDistributor.airdropAll();

      expect(await token0.balanceOf(pool0.address)).to.be.eq(airdropAmount);
      expect(await token1.balanceOf(pool0.address)).to.be.eq(airdropAmount.mul(2));
      expect(await rewardToken.balanceOf(pool0.address)).to.be.eq(airdropAmount.mul(3));
    });
  });
});
