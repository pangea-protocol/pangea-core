import { ethers, network } from "hardhat";
import { describe } from "mocha";
import { MockYToken } from "../../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {expect} from "chai";

/**
 */
describe.only("Y Token TEST", function () {
  let _snapshotId: string;
  let snapshotId: string;

  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;

  let yToken: MockYToken;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    [user1, user2, user3, user4, user5] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockYToken");
    yToken = (await MockToken.deploy()) as MockYToken;

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

  describe("Transfer Test (Simple Case)", async () => {
    it("case 1) ", async () => {
      /**
       * 상황
       * [1] user1가 11 KLAY만큼 스테이킹
       * [2] user2가 18 KLAY만큼 스테이킹
       * [3] yToken re-staking : 2 KLAY
       * 인 상황에서
       *
       * user1 --> user2에게 1 KLAY만큼 보내는 케이스
       */
      // GIVEN
      await yToken
        .connect(user1)
        .stake({ value: ethers.utils.parseEther("11") });
      await yToken
        .connect(user2)
        .stake({ value: ethers.utils.parseEther("18") });
      await yToken.increaseTotalStaking(ethers.utils.parseEther("2"));

      const transferAmount = ethers.utils.parseEther("1");

      // WHEN
      const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      await yToken
        .connect(user1)
        .transfer(user2.address, transferAmount);

      const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // THEN
      expect(before1.sub(after1)).to.be.eq(transferAmount)
      expect(after2.sub(before2)).to.be.eq(transferAmount)
    });
  });

  it("case 2) ", async () => {
    /**
     * 상황
     * [1] user1가 11 KLAY만큼 스테이킹
     * [2] user2가 18 KLAY만큼 스테이킹
     * [3] yToken re-staking : 2 KLAY
     * 인 상황에서
     *
     * user1 --> user2에게 1 KLAY + DUST(1000)만큼 보내는 케이스
     */
    // GIVEN
    await yToken
        .connect(user1)
        .stake({ value: ethers.utils.parseEther("11") });
    await yToken
        .connect(user2)
        .stake({ value: ethers.utils.parseEther("18") });
    await yToken.increaseTotalStaking(ethers.utils.parseEther("2"));

    const DUST = 1000;
    const transferAmount = ethers.utils.parseEther("1").add(DUST);

    // WHEN
    const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

    await yToken
        .connect(user1)
        .transfer(user2.address, transferAmount);

    const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

    // THEN
    expect(before1.sub(after1)).to.be.eq(transferAmount)
    expect(after2.sub(before2)).to.be.eq(transferAmount)
  });

  it.only("case 3) ", async () => {
    /**
     * 상황
     * [1] user1가 11 KLAY만큼 스테이킹
     * [2] user2가 18 KLAY만큼 스테이킹
     * [3] yToken re-staking : 10 KLAY
     * 인 상황에서
     *
     * user1 --> user2에게 1 ETH 미만의 랜덤값 100번 보내는 테스트
     */

    // GIVEN
    await yToken
        .connect(user1)
        .stake({ value: ethers.utils.parseEther("11") });
    await yToken
        .connect(user2)
        .stake({ value: ethers.utils.parseEther("18") });

    await yToken.increaseTotalStaking(ethers.utils.parseEther("10"));

    for (let i=0;i<1000;i++) {
      const transferAmount = ethers.utils.parseEther((Math.random()/100).toPrecision(18).slice(0, 18));

      // WHEN
      const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      await yToken
          .connect(user1)
          .transfer(user2.address, transferAmount);

      const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // THEN
      // expect(before1.sub(after1)).to.be.gte(transferAmount).lte(transferAmount.add(10000))
      // expect(after2.sub(before2)).to.be.gte(transferAmount).lte(transferAmount.add(10000))

      console.log(`${i}th : ${transferAmount} 시도 => 보낸 사람의 오차 : ${before1.sub(after1).sub(transferAmount)} 받은 사람의 오차 : ${after2.sub(before2).sub(transferAmount)}`)
    }
  });
});
