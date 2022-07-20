import { ethers } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { TestTickindex, ConcentratedLiquidityPool } from "../../../types";
import chai, { expect } from "chai";
chai.use(smock.matchers);

describe("TickIndex", function () {
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;

  let testTick: TestTickindex;
  let pool: FakeContract<ConcentratedLiquidityPool>;

  beforeEach("deploy TickIndex", async () => {
    let library = await ethers.getContractFactory("TickIndex");
    let TickIndex = (await library.deploy()).address;
    let factory = await ethers.getContractFactory("TestTickindex", {
      libraries: { TickIndex },
    });

    testTick = (await factory.deploy()) as TestTickindex;
    pool = await smock.fake<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool"
    );
  });

  function setTickSpacing(ts: number) {
    pool.tickSpacing.returns(ts);
  }

  describe("# POOL TICKS SCENARIO 1> tickspacing = 1, ticks = [-887272, -10, -5, 1, 5, 10, 887272]", async () => {
    /**
     * POOL TICKS
     *    : [-887272, -10, -5, 1, 5, 10, 887272]
     * current Tick : 1
     */

    beforeEach("", async () => {
      setTickSpacing(1);
      pool.nearestTick.returns(1);
      pool.ticks.whenCalledWith(MIN_TICK).returns([MIN_TICK, -10, 0, 0, 0, 0]);
      pool.ticks.whenCalledWith(-10).returns([MIN_TICK, -5, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(-5).returns([-10, 1, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(1).returns([-5, 5, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(5).returns([1, 10, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(10).returns([5, MAX_TICK, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(MAX_TICK).returns([10, MAX_TICK, 0, 0, 0, 0]);
    });

    it("CASE 1)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -5
       *    - lower    : -4
       *    - upperOld : 5
       *    - upper    : 7
       *
       * => answer : (-5, -4, 5, 7)
       */
      const answer = await testTick.adjust(pool.address, -5, -4, 5, 7);

      expect(answer[0]).to.be.eq(-5);
      expect(answer[1]).to.be.eq(-4);
      expect(answer[2]).to.be.eq(5);
      expect(answer[3]).to.be.eq(7);
    });

    it("CASE 2)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -7
       *    - lower    : -4
       *    - upperOld : 7
       *    - upper    : 7
       *
       * => answer : (-5, -4, 5, 7)
       */

      const answer = await testTick.adjust(pool.address, -5, -4, 7, 7);

      expect(answer[0]).to.be.eq(-5);
      expect(answer[1]).to.be.eq(-4);
      expect(answer[2]).to.be.eq(5);
      expect(answer[3]).to.be.eq(7);
    });

    it("CASE 3)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -10
       *    - lower    : -4
       *    - upperOld : 10
       *    - upper    : 7
       *
       * => answer : (-5, -4, 5, 7)
       */

      const answer = await testTick.adjust(pool.address, -10, -4, 10, 7);

      expect(answer[0]).to.be.eq(-5);
      expect(answer[1]).to.be.eq(-4);
      expect(answer[2]).to.be.eq(5);
      expect(answer[3]).to.be.eq(7);
    });

    it("CASE 4)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : 1
       *    - lower    : -4
       *    - upperOld : -10
       *    - upper    : 7
       *
       * => answer : (-5, -4, 5, 7)
       */

      const answer = await testTick.adjust(pool.address, 1, -4, -10, 7);

      expect(answer[0]).to.be.eq(-5);
      expect(answer[1]).to.be.eq(-4);
      expect(answer[2]).to.be.eq(5);
      expect(answer[3]).to.be.eq(7);
    });

    it("CASE 5)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -887272
       *    - lower    : -16
       *    - upperOld : -14
       *    - upper    : -13
       *
       * => answer : (-887272, -16, -16, -13)
       */

      const answer = await testTick.adjust(
        pool.address,
        MIN_TICK,
        -16,
        -16,
        -13
      );

      expect(answer[0]).to.be.eq(MIN_TICK);
      expect(answer[1]).to.be.eq(-16);
      expect(answer[2]).to.be.eq(-16);
      expect(answer[3]).to.be.eq(-13);
    });

    it("CASE 6)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -10
       *    - lower    : -8
       *    - upperOld : -8
       *    - upper    : -5
       *
       * => answer : (-10, -8, -8, -5)
       */

      const answer = await testTick.adjust(pool.address, -10, -8, -8, -5);

      expect(answer[0]).to.be.eq(-10);
      expect(answer[1]).to.be.eq(-8);
      expect(answer[2]).to.be.eq(-8);
      expect(answer[3]).to.be.eq(-5);
    });

    it("CASE 7)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -5
       *    - lower    : 6
       *    - upperOld : 6
       *    - upper    : 887271
       *
       * => answer : (5, 6, 10, 887271)
       */

      const answer = await testTick.adjust(pool.address, -5, 6, 6, 887271);

      expect(answer[0]).to.be.eq(5);
      expect(answer[1]).to.be.eq(6);
      expect(answer[2]).to.be.eq(10);
      expect(answer[3]).to.be.eq(887271);
    });

    it("CASE 8)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : 2
       *    - lower    : 2
       *    - upperOld : 5
       *    - upper    : 9
       *
       * => answer : (1, 2, 5, 9)
       */

      const answer = await testTick.adjust(pool.address, 1, 2, 5, 9);

      expect(answer[0]).to.be.eq(1);
      expect(answer[1]).to.be.eq(2);
      expect(answer[2]).to.be.eq(5);
      expect(answer[3]).to.be.eq(9);
    });

    it("CASE 9)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -10, -5, 1, 5, 10, 887272]
       * current Tick : 1
       *
       * input parameter
       *    - lowerOld : -887273
       *    - lower    : -887273
       *    - upperOld : 887273
       *    - upper    : 887273
       *
       * => answer : (-887272, -887272, 10, 887271)
       */

      const answer = await testTick.adjust(
        pool.address,
        -887273,
        -887273,
        887273,
        887273
      );

      expect(answer[0]).to.be.eq(-887272);
      expect(answer[1]).to.be.eq(-887270);
      expect(answer[2]).to.be.eq(10);
      expect(answer[3]).to.be.eq(887271);
    });
  });

  describe("# POOL TICKS SCENARIO 2> tickspacing = 10, ticks = [-887272, -100, -60, 10, 50, 100, 887272]", async () => {
    /**
     * POOL TICKS
     *    : [-887272, -100, -60, 10, 50, 100, 887272]
     * current Tick : 10
     */

    beforeEach("", async () => {
      setTickSpacing(10);
      pool.nearestTick.returns(1);
      pool.ticks.whenCalledWith(MIN_TICK).returns([MIN_TICK, -100, 0, 0, 0, 0]);
      pool.ticks.whenCalledWith(-100).returns([MIN_TICK, -60, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(-60).returns([-100, 10, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(10).returns([-60, 50, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(50).returns([10, 100, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(100).returns([50, MAX_TICK, 1, 0, 0, 0]);
      pool.ticks.whenCalledWith(MAX_TICK).returns([100, MAX_TICK, 0, 0, 0, 0]);
    });

    it("CASE 1)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -100, -60, 10, 50, 100, 887272]
       * current Tick : 10
       *
       * input parameter
       *    - lowerOld : -100
       *    - lower    : -68
       *    - upperOld : 50
       *    - upper    : 78
       *
       * => answer : (-100, -60, 50, 70)
       */
      const answer = await testTick.adjust(pool.address, -100, -68, 50, 78);

      expect(answer[0]).to.be.eq(-100);
      expect(answer[1]).to.be.eq(-60);
      expect(answer[2]).to.be.eq(50);
      expect(answer[3]).to.be.eq(70);
    });

    it("CASE 2)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -100, -60, 10, 50, 100, 887272]
       * current Tick : 10
       *
       * input parameter
       *    - lowerOld : -60
       *    - lower    : -8
       *    - upperOld : -60
       *    - upper    : -8
       *
       * => answer : (-60, 0, 10, 10)
       */
      const answer = await testTick.adjust(pool.address, -60, -8, -60, -8);

      expect(answer[0]).to.be.eq(-60);
      expect(answer[1]).to.be.eq(0);
      expect(answer[2]).to.be.eq(0);
      expect(answer[3]).to.be.eq(10);
    });

    it("CASE 3)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -100, -60, 10, 50, 100, 887272]
       * current Tick : 10
       *
       * input parameter
       *    - lowerOld : 10
       *    - lower    : 5
       *    - upperOld : 10
       *    - upper    : 5
       *
       * => answer : (-60, 0, 10, 10)
       */
      const answer = await testTick.adjust(pool.address, 10, 5, 10, 5);

      expect(answer[0]).to.be.eq(-60);
      expect(answer[1]).to.be.eq(0);
      expect(answer[2]).to.be.eq(0);
      expect(answer[3]).to.be.eq(10);
    });

    it("CASE 4)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -100, -60, 10, 50, 100, 887272]
       * current Tick : 10
       *
       * input parameter
       *    - lowerOld : 10
       *    - lower    : 15
       *    - upperOld : 10
       *    - upper    : 15
       *
       * => answer : (-60, 0, 10, 10)
       */
      const answer = await testTick.adjust(pool.address, 10, 15, 10, 15);

      expect(answer[0]).to.be.eq(-60);
      expect(answer[1]).to.be.eq(0);
      expect(answer[2]).to.be.eq(0);
      expect(answer[3]).to.be.eq(10);
    });

    it("CASE 4)", async () => {
      /**
       * POOL TICKS
       *    : [-887272, -100, -60, 10, 50, 100, 887272]
       * current Tick : 10
       *
       * input parameter
       *    - lowerOld : -887272
       *    - lower    : -887272
       *    - upperOld : 887272
       *    - upper    : 887272
       *
       * => answer : (-887272, -887260, 100, 887250)
       */
      const answer = await testTick.adjust(
        pool.address,
        -887272,
        -887272,
        887272,
        887272
      );

      expect(answer[0]).to.be.eq(-887272);
      expect(answer[1]).to.be.eq(-887260);
      expect(answer[2]).to.be.eq(100);
      expect(answer[3]).to.be.eq(887250);
    });
  });
});
