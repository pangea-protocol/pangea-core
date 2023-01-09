import { ethers, network } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import chai, { expect } from "chai";
import { describe } from "mocha";
import {
  AirdropDistributorV2,
  IERC20Metadata,
  MiningPool,
  StoneScheduler,
} from "../../../types";
import { SignerWithAddress } from "hardhat-deploy-ethers/signers";
chai.use(smock.matchers);

describe("STONE SCHEDULER", async () => {
  let _snapshotId: string;
  let snapshotId: string;
  let deployer: SignerWithAddress;
  let airdropDistributorV2: FakeContract<AirdropDistributorV2>;
  let stone: FakeContract<IERC20Metadata>;
  let pool0: FakeContract<MiningPool>;
  let pool1: FakeContract<MiningPool>;
  let pool2: FakeContract<MiningPool>;
  let pool3: FakeContract<MiningPool>;
  let stoneScheduler: StoneScheduler;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);
    [deployer] = await ethers.getSigners();

    airdropDistributorV2 = await smock.fake<AirdropDistributorV2>(
      "AirdropDistributorV2"
    );
    stone = await smock.fake<IERC20Metadata>("IERC20Metadata");

    pool0 = await smock.fake<MiningPool>("MiningPool");
    pool1 = await smock.fake<MiningPool>("MiningPool");
    pool2 = await smock.fake<MiningPool>("MiningPool");
    pool3 = await smock.fake<MiningPool>("MiningPool");

    stoneScheduler = (await (
      await ethers.getContractFactory("StoneScheduler")
    ).deploy()) as StoneScheduler;

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

  describe("# addTargetPool & removeTargetPool", async () => {
    beforeEach("setup", async () => {
      await stoneScheduler.initialize(
        airdropDistributorV2.address,
        stone.address,
        [pool0.address, pool1.address, pool2.address]
      );
    });

    it("totalTargetPool", async () => {
      expect(await stoneScheduler.totalTargetPool()).to.be.eq(3);

      expect(await stoneScheduler.isTargetPool(pool0.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool1.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool2.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool3.address)).to.be.eq(false);

      expect(await stoneScheduler.targetPools(0)).to.be.eq(pool0.address);
      expect(await stoneScheduler.targetPools(1)).to.be.eq(pool1.address);
      expect(await stoneScheduler.targetPools(2)).to.be.eq(pool2.address);
    });

    it("revert addTargetPool if exists", async () => {
      await expect(stoneScheduler.addTargetPool(pool0.address)).to.be.reverted;
    });

    it("addTargetPool", async () => {
      await stoneScheduler.addTargetPool(pool3.address);

      expect(await stoneScheduler.totalTargetPool()).to.be.eq(4);

      expect(await stoneScheduler.isTargetPool(pool0.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool1.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool2.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool3.address)).to.be.eq(true);

      expect(await stoneScheduler.targetPools(0)).to.be.eq(pool0.address);
      expect(await stoneScheduler.targetPools(1)).to.be.eq(pool1.address);
      expect(await stoneScheduler.targetPools(2)).to.be.eq(pool2.address);
      expect(await stoneScheduler.targetPools(3)).to.be.eq(pool3.address);
    });

    it("revert removeTargetPool if not exists", async () => {
      await expect(stoneScheduler.removeTargetPool(pool3.address)).to.be
        .reverted;
    });

    it("removeTargetPool", async () => {
      await stoneScheduler.removeTargetPool(pool1.address);

      expect(await stoneScheduler.totalTargetPool()).to.be.eq(2);

      expect(await stoneScheduler.isTargetPool(pool0.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool1.address)).to.be.eq(false);
      expect(await stoneScheduler.isTargetPool(pool2.address)).to.be.eq(true);
      expect(await stoneScheduler.isTargetPool(pool3.address)).to.be.eq(false);

      expect(await stoneScheduler.targetPools(0)).to.be.eq(pool0.address);
      expect(await stoneScheduler.targetPools(1)).to.be.eq(pool2.address);
    });
  });

  describe("# allocate & deposit", async () => {
    beforeEach("setup", async () => {
      await stoneScheduler.initialize(
        airdropDistributorV2.address,
        stone.address,
        [pool0.address, pool1.address, pool2.address]
      );
    });

    it("revert allocate if not target pools", async () => {
      const currentEpochStartTime =
        await stoneScheduler.currentEpochStartTime();

      await expect(
        stoneScheduler.allocate(
          pool3.address,
          currentEpochStartTime.add(604800),
          ethers.utils.parseEther("1")
        )
      ).to.be.reverted;
    });

    it("revert allocate if wrong epochStartTime", async () => {
      const currentEpochStartTime =
        await stoneScheduler.currentEpochStartTime();

      await expect(
        stoneScheduler.allocate(
          pool0.address,
          currentEpochStartTime,
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("PAST EPOCH");

      await expect(
        stoneScheduler.allocate(
          pool0.address,
          currentEpochStartTime.add(604801),
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("INVALID EPOCH START TIME");
    });

    it("allocate and depositEpoch", async () => {
      const currentEpochStartTime =
        await stoneScheduler.currentEpochStartTime();
      const epochStartTime0 = currentEpochStartTime.add(604800);
      const epochStartTime1 = currentEpochStartTime.add(604800 * 2);

      await stoneScheduler.allocate(
        pool0.address,
        epochStartTime0,
        ethers.utils.parseEther("1")
      );
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("1"));

      await stoneScheduler.allocate(
        pool1.address,
        epochStartTime0,
        ethers.utils.parseEther("2")
      );
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool1.address)
      ).to.be.eq(ethers.utils.parseEther("2"));

      await stoneScheduler.allocate(
        pool0.address,
        epochStartTime1,
        ethers.utils.parseEther("3")
      );
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("3"));

      await stoneScheduler.allocate(
        pool2.address,
        epochStartTime1,
        ethers.utils.parseEther("4")
      );
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool2.address)
      ).to.be.eq(ethers.utils.parseEther("4"));

      await stoneScheduler.depositEpoch();

      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool1.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("3"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool2.address)
      ).to.be.eq(ethers.utils.parseEther("4"));

      await setNextTimeStamp(epochStartTime0.toNumber());
      await stoneScheduler.depositEpoch();

      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime0, pool1.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool0.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
      expect(
        await stoneScheduler.scheduledAmounts(epochStartTime1, pool2.address)
      ).to.be.eq(ethers.utils.parseEther("0"));
    });
  });
});
