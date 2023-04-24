import { ethers, network } from "hardhat";
import {
  ERC20Test,
  MasterDeployer,
  MiningPoolManager,
  MockGCKlay,
  PoolRouter,
  GCKlayPool,
  GCKlayPoolFactory,
} from "../../../types";
import { BigNumber, BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { getDx, getPriceAtTick } from "../../harness/utils";
import { expect } from "chai";
import { GCKlayPangea } from "./GCKlayPangea";

describe("GCKlayPool TEST", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 0;
  const TICK_SPACING = 20;
  const DAY = 3600 * 24;
  const WEEK = DAY * 7;
  const DUST_VALUE_LIMIT = 300;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdrop: SignerWithAddress;

  let pangea: GCKlayPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: GCKlayPoolFactory;
  let poolManager: MiningPoolManager;
  let pool: GCKlayPool;
  let router: PoolRouter;

  let KLAY: ERC20Test;
  let mockGCKlay: MockGCKlay;
  let KLY: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdrop] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await GCKlayPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;
    mockGCKlay = pangea.gcKlay;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    KLAY = (await Token.deploy("KLAY", "KLAY", 18)) as ERC20Test;
    KLY = (await Token.deploy("KLY", "KLY", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    const [tokenN0Address, tokenN1Address] =
      KLAY.address.toLowerCase() < mockGCKlay.address.toLowerCase()
        ? [KLAY.address, mockGCKlay.address]
        : [mockGCKlay.address, KLAY.address];

    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint24", "uint160", "uint24"],
        [
          tokenN0Address,
          tokenN1Address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );
    await masterDeployer.setAirdropDistributor(airdrop.address);

    const poolAddress = (
      await poolFactory.getPools(KLAY.address, mockGCKlay.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<GCKlayPool>("GCKlayPool", poolAddress);

    await KLY.mint(airdrop.address, ethers.constants.MaxUint256.div(10));
    await KLY.connect(airdrop).approve(
      poolAddress,
      ethers.constants.MaxUint256
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
    await KLAY.burnAll(liquidityProvider.address);
    await mockGCKlay
      .connect(liquidityProvider)
      .transfer(
        deployer.address,
        await mockGCKlay.balanceOf(liquidityProvider.address)
      );
  }

  async function clearBalance() {
    await KLAY.burnAll(liquidityProvider.address);
    await mockGCKlay
      .connect(liquidityProvider)
      .transfer(
        deployer.address,
        await mockGCKlay.balanceOf(liquidityProvider.address)
      );
  }

  async function depositReward(value: BigNumberish) {
    await deployer.sendTransaction({ to: mockGCKlay.address, value });
  }

  async function swapKLAY2stKLAY(amountIn: BigNumber) {
    // For test, trader always mint token
    await KLAY.connect(trader).mint(trader.address, amountIn);
    await KLAY.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: KLAY.address,
      amountIn,
      amountOutMinimum: 0,
      pool: pool.address,
      to: trader.address,
      unwrap: false,
    });
  }

  async function swapstKLAY2KLAY(amountIn: BigNumber) {
    await mockGCKlay.connect(trader).stake({ value: amountIn });
    await mockGCKlay.connect(trader).approve(router.address, amountIn);

    await router.connect(trader).exactInputSingle({
      tokenIn: mockGCKlay.address,
      amountIn,
      amountOutMinimum: 0,
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
    await KLAY.mint(liquidityProvider.address, amountDesired);
    await KLAY.connect(liquidityProvider).approve(
      poolManager.address,
      amountDesired
    );

    await mockGCKlay.connect(liquidityProvider).stake({ value: amountDesired });
    await mockGCKlay
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
        await KLAY.balanceOf(liquidityProvider.address)
      ),
      token1: amountDesired.sub(
        await mockGCKlay.balanceOf(liquidityProvider.address)
      ),
    };
  }

  async function addLiquidity(positionId: BigNumber, multiplier: number) {
    const amountDesired = ethers.utils.parseEther("100").mul(multiplier);

    await clearBalance();

    await KLAY.mint(liquidityProvider.address, amountDesired);
    await KLAY.connect(liquidityProvider).approve(
      poolManager.address,
      amountDesired
    );

    await mockGCKlay.connect(liquidityProvider).stake({ value: amountDesired });
    await mockGCKlay
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
        await KLAY.balanceOf(liquidityProvider.address)
      ),
      token1: amountDesired.sub(
        await mockGCKlay.balanceOf(liquidityProvider.address)
      ),
    };
  }

  /**
   * 시나리오 테스트
   * > 유동성을 공급한 포지션이 존재하였을 때, 납입한 유동성과 예치한 시간에 비례하여 KLY가 올바르게 분배되는가?
   */
  describe("# KLY 분배 시나리오 테스트", async () => {
    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *                                |<------------LP2---------->| => LP의 크기 = 1X
     */
    it("동일한 두 포지션에서의 KLY 분배", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // 에어드랍을 수행합니다.
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // 에어드랍의 분배가 종료되었습니다.
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod);

      // 포지션 1번이 받을 수 있는 리워드의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp1.positionId);

      // 포지션 2번이 받을 수 있는 리워드의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp2.positionId);

      // 두 포지션 모두 제공된 리워드의 절받을 가져감
      const allocatedReward = givenReward.div(2);

      // 받은 리워드는 제공된 리워드 절반
      expect(lp1Reward.rewardAmount.sub(allocatedReward).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
      expect(lp2Reward.rewardAmount.sub(allocatedReward).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *        |<--LP2---->| => LP의 크기 = 1X
     */
    it("In Range 포지션과 out Range 포지션 간의 리워드 분배 비교", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(
        -10 * TICK_SPACING,
        -6 * TICK_SPACING,
        1
      );
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // 에어드랍을 수행합니다.
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // 에어드랍의 분배가 종료되었습니다.
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod);

      // 포지션 1번이 받을 수 있는 KLY 리워드의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp1.positionId);

      // 포지션 2번이 받을 수 있는 KLY 리워드의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp2.positionId);

      // in range 포지션은 제공된 KLY 모두 수취
      expect(lp1Reward.rewardAmount.sub(givenReward).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
      // out range 포지션은 KLY가 전혀 없음
      expect(lp2Reward.rewardAmount).to.be.eq(0);
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *                                |<------------LP2---------->| => LP의 크기 = 2X
     */
    it("리퀴디티 크기가 1 : 2인 두 포지션의 리워드 비교", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 2);
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // 에어드랍을 수행합니다.
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // 에어드랍의 분배가 종료되었습니다.
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod);

      // 포지션 1번이 받을 수 있는 KLY 리워드의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp1.positionId);

      // 포지션 2번이 받을 수 있는 KLY 리워드의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp2.positionId);

      // 두 포지션의 리워드는 1:2의 비율로 가져감
      const allocatedReward0 = givenReward.div(3);
      const allocatedReward1 = givenReward.mul(2).div(3);

      expect(lp1Reward.rewardAmount.sub(allocatedReward0).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
      expect(lp2Reward.rewardAmount.sub(allocatedReward1).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *                    |<--------------------------0 (에어드랍 시기가 1/2 정도 지나갔을 때, 스왑 수행)
     *        |<-----LP2----->| => LP의 크기
     *
     * 에어드랍 물량의 절반은 LP1에 분배 (절반 시간동안 LP1에 있었기 떄문)
     * 남은 절반은 LP2에 분배
     */
    it("시간에 따른 에어드랍 분배 계산", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(
        -10 * TICK_SPACING,
        -6 * TICK_SPACING,
        1
      );

      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // 에어드랍을 수행합니다.
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // 에어드랍의 절반 지나감
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod / 2);

      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-6 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // 스왑 수행 (LP1의 포지션에서 LP2의 포지션 쪽으로 가격이 벗어남)
      if ((await pool.token0()).toLowerCase() == KLAY.address) {
        await swapKLAY2stKLAY(inputAmount);
      } else {
        await swapstKLAY2KLAY(inputAmount);
      }
      const swapTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;

      // 에어드랍이 완전히 지나감
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod);

      // 포지션 1번이 받을 수 있는 KLY 리워드의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp1.positionId);

      // 포지션 2번이 받을 수 있는 KLY 리워드의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp2.positionId);

      // 두 포지션의 리워드는 시간에 비례하여 분배
      const allocatedReward0 = givenReward
        .mul(swapTimestamp - givenAirdropStartTime)
        .div(givenAirdropPeriod);
      const allocatedReward1 = givenReward
        .mul(givenAirdropStartTime + givenAirdropPeriod - swapTimestamp)
        .div(givenAirdropPeriod);

      expect(lp1Reward.rewardAmount.sub(allocatedReward0).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
      expect(lp2Reward.rewardAmount.sub(allocatedReward1).abs()).to.be.lt(
        DUST_VALUE_LIMIT
      );
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                    |<--------------------------0 (에어드랍 시기가 1/2 정도 지나갔을 때, 스왑 수행)
     *        |<-----LP2----->| => LP의 크기
     *
     * 에어드랍 물량 모두 LP2에 분배 (없었던 시기의 에어드랍 물량 이월)
     */
    it("유동성이 없었을 때, 발생했던 에어드랍 물량 이월", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp2 = await mintNewPosition(
        -10 * TICK_SPACING,
        -6 * TICK_SPACING,
        1
      );

      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // 에어드랍을 수행합니다.
      const givenAirdropStartTime =
        (await ethers.provider.getBlock("latest")).timestamp + 3600;
      const givenAirdropPeriod = WEEK;
      const givenReward = ethers.utils.parseEther("12");
      await pool
        .connect(airdrop)
        .depositAirdropAndReward(
          0,
          0,
          givenReward,
          givenAirdropStartTime,
          givenAirdropPeriod
        );

      // 에어드랍의 절반 지나감
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod / 2);

      const currentPrice = await getPriceAtTick(-6 * TICK_SPACING);
      const targetPrice = await getPriceAtTick(-7 * TICK_SPACING);
      const inputAmount = await getDx(
        lp2.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // 스왑 수행 (LP1의 포지션에서 LP2의 포지션 쪽으로 가격이 벗어남)
      if ((await pool.token0()).toLowerCase() == KLAY.address) {
        await swapKLAY2stKLAY(inputAmount);
      } else {
        await swapstKLAY2KLAY(inputAmount);
      }

      // 에어드랍이 완전히 지나감
      await setNextTimeStamp(givenAirdropStartTime + givenAirdropPeriod);

      // 포지션 2번이 받을 수 있는 KLY 리워드의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionRewardAmount(lp2.positionId);

      expect(lp2Reward.rewardAmount).to.be.closeTo(
        givenReward,
        DUST_VALUE_LIMIT
      );
    });
  });

  /**
   * 시나리오 테스트
   * > 유동성을 공급한 포지션이 존재하였을 때, 납입한 유동성과 예치한 시간에 비례하여 stKLAY가 올바르게 분배되는가?
   *
   */
  describe("# stKLAY 분배 시나리오 테스트", async () => {
    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *                                |<------------LP2---------->| => LP의 크기 = 1X
     */
    it("동일한 두 포지션에서의 stKLAY 분배", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // increaseTotalStaking을 통해 리워드 늘림
      const givenReward = ethers.utils.parseEther("12");
      await depositReward(givenReward);

      // 포지션 1번이 받을 수 있는 stKLAY의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp1.positionId);

      // 포지션 2번이 받을 수 있는 stKLAY의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp2.positionId);

      const allocatedReward = givenReward.mul(9).div(10).div(2); // 프로토콜 수수료 = 10%

      if ((await pool.token0()).toLowerCase() == KLAY.address.toLowerCase()) {
        expect(lp1Reward.token1amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token1amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
      } else {
        expect(lp1Reward.token0amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token0amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
      }

      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *                                |<------------LP2---------->| => LP의 크기 = 2X
     */
    it("1 : 2의 유동성 크기를 가진 두 포지션에서의 stKLAY 분배", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 2);
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // increaseTotalStaking을 통해 리워드 늘림
      const givenReward = ethers.utils.parseEther("12");
      await depositReward(givenReward);

      // 포지션 1번이 받을 수 있는 stKLAY의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp1.positionId);

      // 포지션 2번이 받을 수 있는 stKLAY의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp2.positionId);

      const allocatedReward = givenReward.mul(9).div(10); // 프로토콜 수수료 = 10%

      if ((await pool.token0()).toLowerCase() == KLAY.address.toLowerCase()) {
        expect(lp1Reward.token1amount).to.be.closeTo(
          allocatedReward.div(3),
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token1amount).to.be.closeTo(
          allocatedReward.mul(2).div(3),
          DUST_VALUE_LIMIT
        );
      } else {
        expect(lp1Reward.token0amount).to.be.closeTo(
          allocatedReward.div(3),
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token0amount).to.be.closeTo(
          allocatedReward.mul(2).div(3),
          DUST_VALUE_LIMIT
        );
      }

      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->|
     *        |<-------LP2------->|
     */
    it("out Of Range와 In Range 두 포지션에서의 stKLAY 분배", async () => {
      // 동일한 크기의 두개 포지션을 생성합니다.
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(
        -10 * TICK_SPACING,
        -5 * TICK_SPACING,
        1
      );
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // increaseTotalStaking을 통해 리워드 늘림
      const givenReward = ethers.utils.parseEther("12");
      await depositReward(givenReward);

      // 포지션 1번이 받을 수 있는 stKLAY의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp1.positionId);

      // 포지션 2번이 받을 수 있는 stKLAY의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp2.positionId);

      const allocatedReward = givenReward.mul(9).div(10); // 프로토콜 수수료 = 10%

      if ((await pool.token0()).toLowerCase() == KLAY.address.toLowerCase()) {
        expect(lp1Reward.token1amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token1amount).to.be.closeTo(
          BigNumber.from(0),
          DUST_VALUE_LIMIT
        );
      } else {
        expect(lp1Reward.token0amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token0amount).to.be.closeTo(
          BigNumber.from(0),
          DUST_VALUE_LIMIT
        );
      }

      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
    });

    /*
     *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
     * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
     *
     *                                |<------------LP1---------->| => LP의 크기 = 1X
     *        |<-----LP2----->| => LP의 크기
     *                                                  [1] increaseTotalStaking
     *                    |<--------------------------0 [2] 스왑
     *                                                  [3] increaseTotalStaking
     *
     * 에어드랍 물량의 절반은 LP1에 분배 (절반 시간동안 LP1에 있었기 떄문)
     * 남은 절반은 LP2에 분배
     */
    it("스왑 후, 두 포지션에서의 stKLAY 분배", async () => {
      const lp1 = await mintNewPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const lp2 = await mintNewPosition(
        -10 * TICK_SPACING,
        -5 * TICK_SPACING,
        1
      );
      await clearLPBalance(); // 계산을 위해, 밸런스 삭제

      // [1] increaseTotalStaking을 통해 리워드 늘림
      const givenReward = ethers.utils.parseEther("12");
      await depositReward(givenReward);

      // [2] 스왑 처리
      const currentPrice = await getPriceAtTick(0);
      const targetPrice = await getPriceAtTick(-6 * TICK_SPACING);
      const inputAmount = await getDx(
        lp1.liquidity,
        targetPrice,
        currentPrice,
        true
      );

      // 스왑 수행 (LP1의 포지션에서 LP2의 포지션 쪽으로 가격이 벗어남)
      if ((await pool.token0()).toLowerCase() == KLAY.address) {
        await swapKLAY2stKLAY(inputAmount);
      } else {
        await swapstKLAY2KLAY(inputAmount);
      }

      await clearBalance();

      // [3]  increaseTotalStaking을 통해 리워드 늘림
      await depositReward(givenReward);

      // 포지션 1번이 받을 수 있는 stKLAY의 크기
      const lp1Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp1.positionId);

      // 포지션 2번이 받을 수 있는 stKLAY의 크기
      const lp2Reward = await poolManager
        .connect(liquidityProvider)
        .positionFees(lp2.positionId);

      const allocatedReward = givenReward.mul(9).div(10); // 프로토콜 수수료 = 10%

      if ((await pool.token0()).toLowerCase() == KLAY.address.toLowerCase()) {
        expect(lp1Reward.token1amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token1amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
      } else {
        expect(lp1Reward.token0amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
        expect(lp2Reward.token0amount).to.be.closeTo(
          allocatedReward,
          DUST_VALUE_LIMIT
        );
      }

      await poolManager
        .connect(liquidityProvider)
        .collect(lp1.positionId, liquidityProvider.address, false);
      await poolManager
        .connect(liquidityProvider)
        .collect(lp2.positionId, liquidityProvider.address, false);
    });

    it("생성 소각 반복", async () => {
      // [1] increaseTotalStaking을 통해 share와 balance의 차이 발생시키기
      await mockGCKlay
        .connect(trader)
        .stake({ value: ethers.utils.parseEther("5012.381040013000129") });
      await depositReward(ethers.utils.parseEther("1.1219210370101"));

      for (let i = 0; i < 20; i++) {
        // [2] 포지션 생성
        let lp1 = await mintNewPosition(-4 * TICK_SPACING, 5 * TICK_SPACING, 1);
        await clearLPBalance();

        // [3] staking
        await depositReward(randomBN(ethers.utils.parseEther("0.001")));

        // [4] 모두 소각
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
        await clearLPBalance();

        await pool.collectProtocolFee();
      }
    });
  });

  function randomBN(max) {
    return ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(max);
  }
});
