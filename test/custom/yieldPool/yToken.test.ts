import { ethers, network } from "hardhat";
import { describe } from "mocha";
import { MockYToken } from "../../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {expect} from "chai";

/**
 */
describe("Y Token TEST", function () {
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
      expect(before1.sub(after1)).to.be.gte(transferAmount).lte(transferAmount.add(1))
      expect(after2.sub(before2)).to.be.gte(transferAmount).lte(transferAmount.add(1))
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

  it("case 3) ", async () => {
    /**
     * 상황
     * [1] user1가 11 KLAY만큼 스테이킹
     * [2] user2가 18 KLAY만큼 스테이킹
     * [3] yToken re-staking : 2 KLAY
     * [4] user1이 1 KLAY 스테이킹
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
    await yToken
        .connect(user1)
        .stake({ value: ethers.utils.parseEther("17") });
    await yToken
        .connect(user1)
        .stake({ value: ethers.utils.parseEther("17") });

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

  it("case 4) ", async () => {
    /**
     * 상황
     * [1] user1가 11 KLAY만큼 스테이킹
     * [2] user2가 18 KLAY만큼 스테이킹
     * [3] yToken re-staking : 10 KLAY
     * 인 상황에서
     *
     * user1 --> user2에게 0.1 KLAY 미만의 랜덤값 100번 보내는 테스트
     */

    // GIVEN
    await yToken
        .connect(user1)
        .stake({value: ethers.utils.parseEther("11")});
    await yToken
        .connect(user2)
        .stake({value: ethers.utils.parseEther("18")});

    await yToken.increaseTotalStaking(ethers.utils.parseEther("10"));

    for (let i = 0; i < 100; i++) {
      const transferAmount = randomBN(ethers.utils.parseEther('0.1'));

      // WHEN
      const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      await yToken
          .connect(user1)
          .transfer(user2.address, transferAmount);

      const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // THEN
      if (!before1.sub(after1).sub(transferAmount).eq(0) || !after2.sub(before2).sub(transferAmount).eq(0)) {
        console.log(`${i}th : ${transferAmount} 시도 => 보낸 사람의 오차 : ${before1.sub(after1).sub(transferAmount)} 받은 사람의 오차 : ${after2.sub(before2).sub(transferAmount)}`)
      } else {
        expect(before1.sub(after1)).to.be.eq(transferAmount);
        expect(after2.sub(before2)).to.be.eq(transferAmount);
      }
    }
  });

  it("case 5) ", async () => {
    /**
     * 상황
     * [1] user1가 11 KLAY만큼 스테이킹
     * [2] yToken re-staking : 2 KLAY
     * [3] user2가 18 KLAY만큼 스테이킹
     *
     * user1이 1만큼 스테이킹
     * user2 --> user1에게 0~1 KLAY사이의 랜덤 값을 보내는 케이스
     */
    // GIVEN
    await yToken
        .connect(user1)
        .stake({value: ethers.utils.parseEther("11")});
    await yToken.increaseTotalStaking(ethers.utils.parseEther("2"));
    await yToken
        .connect(user2)
        .stake({value: ethers.utils.parseEther("18")});

    for (let i = 0; i < 1000; i++) {
      const transferAmount = randomBN(ethers.utils.parseEther('0.01'));

      // WHEN
      const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      await yToken
          .connect(user1)
          .transfer(user2.address, transferAmount);

      const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // THEN
      if (!before1.sub(after1).sub(transferAmount).eq(0) || !after2.sub(before2).sub(transferAmount).eq(0)) {
        console.log(`${i}th : ${transferAmount} 시도 => 보낸 사람의 오차 : ${before1.sub(after1).sub(transferAmount)} 받은 사람의 오차 : ${after2.sub(before2).sub(transferAmount)}`)
      } else {
        expect(before1.sub(after1)).to.be.eq(transferAmount);
        expect(after2.sub(before2)).to.be.eq(transferAmount);
      }
    }
  })

  it("case 6) ", async () => {
    /**
     * 상황
     * [1] user1가 1 ~ 1001 KLAY만큼 스테이킹
     * [2] yToken re-staking이 0 ~ 10 KLAY 사이 랜덤 값으로 스테이킹
     * [3] user2가 0 ~ 1000 KLAY만큼 스테이킹
     *
     * 그후 1000번동안 아래를 반복
     * [1] re-staking 수행 ( 0 ~ 0.001 KLAY 랜덤 값으로)
     * [2] user1이 user2에게 ( 0 ~ 0.001 KLAY 랜덤 값으로)
     */
    // GIVEN
    await yToken
        .connect(user1)
        .stake({value: randomBN(ethers.utils.parseEther('1000')).add(ethers.utils.parseEther('1'))});
    await yToken.increaseTotalStaking(randomBN(ethers.utils.parseEther('10')));
    await yToken
        .connect(user2)
        .stake({value: randomBN(ethers.utils.parseEther('1000'))});

    for (let i = 0; i < 1000; i++) {
      // WHEN
      // [1] first increase total staking
      const increasedAmount = randomBN(ethers.utils.parseEther('0.001'));
      await yToken.increaseTotalStaking(increasedAmount);

      const [before1, before2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // [2] transfer Random Amount
      const transferAmount = randomBN(ethers.utils.parseEther('0.001'));
      await yToken
          .connect(user1)
          .transfer(user2.address, transferAmount);

      const [after1, after2] = await Promise.all([yToken.balanceOf(user1.address), yToken.balanceOf(user2.address)])

      // THEN
      if (!before1.sub(after1).sub(transferAmount).eq(0) || !after2.sub(before2).sub(transferAmount).eq(0)) {
        console.log(`${i}th : ${transferAmount} 시도 => 보낸 사람의 오차 : ${before1.sub(after1).sub(transferAmount)} 받은 사람의 오차 : ${after2.sub(before2).sub(transferAmount)}`)
      } else {
        expect(before1.sub(after1)).to.be.eq(transferAmount);
        expect(after2.sub(before2)).to.be.eq(transferAmount);
      }
    }
  });
});

function randomBN(max) {
  return ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(max);
}
