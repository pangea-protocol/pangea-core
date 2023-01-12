import { ethers, network } from "hardhat";
import {
  ERC20Test,
  MasterDeployer,
  MiningPool,
  MiningPoolFactory,
  MiningPoolManager,
  PoolRouter,
  PositionDashboardV2,
  PositionHelper,
  WETH10,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { sortTokens } from "../../harness/utils";
import { MiningPangea } from "./MiningPangea";

/**
 * Test for Mint & Burn in Reward Liquidity Pool
 *
 * [1] Is the liquidity value calculated correctly based on the price range?
 *
 * [2] Is it calculated correctly when liquidity is supplied within the same range?
 *
 * [3] Is it calculated correctly when liquidity is supplied within the different ranges?
 *
 * [4] If an existing Fee exists, can it be claimed later even if additional liquidity is supplied?
 *
 * [5] If an existing Fee exists, can it be claimed later even if the liquidity is partially burned?
 *
 * [6] When all liquidity is removed, does the Fee return?
 *
 */
describe("Reward Liquidity Pool SCENARIO:MINT_AND_BURN", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let trader: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;

  let pangea: MiningPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: MiningPoolFactory;
  let poolManager: MiningPoolManager;
  let pool: MiningPool;
  let nativePool: MiningPool;
  let positionHelper: PositionHelper;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let rewardToken: ERC20Test;
  let wklay: WETH10;
  let dashboard: PositionDashboardV2;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, trader, liquidityProvider] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await MiningPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;
    wklay = pangea.weth;
    dashboard = (await (
      await ethers.getContractFactory("PositionDashboardV2")
    ).deploy()) as PositionDashboardV2;

    // ========= PositionHelper =========
    const Factory = await ethers.getContractFactory("PositionHelper");
    positionHelper = (await Factory.deploy(
      poolManager.address
    )) as PositionHelper;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    rewardToken = (await Token.deploy("REWARD", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
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
    const [tokenN0, tokenN1] =
      token0.address.toLowerCase() < wklay.address.toLowerCase()
        ? [token0.address, wklay.address]
        : [wklay.address, token0.address];
    await masterDeployer.deployPool(
      poolFactory.address,
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "address", "uint24", "uint160", "uint24"],
        [
          tokenN0,
          tokenN1,
          rewardToken.address,
          BigNumber.from(SWAP_FEE),
          TWO_POW_96,
          BigNumber.from(TICK_SPACING),
        ]
      )
    );
    await expect(
      masterDeployer.deployPool(
        poolFactory.address,
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "uint24", "uint160", "uint24"],
          [
            tokenN1,
            tokenN0,
            rewardToken.address,
            BigNumber.from(SWAP_FEE + 1),
            TWO_POW_96,
            BigNumber.from(TICK_SPACING),
          ]
        )
      )
    ).to.be.reverted;

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<MiningPool>("MiningPool", poolAddress);

    const nativePoolAddress = (
      await poolFactory.getPools(token0.address, wklay.address, 0, 1)
    )[0];
    nativePool = await ethers.getContractAt<MiningPool>(
      "MiningPool",
      nativePoolAddress
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

  async function clearBalance() {
    await token0.burnAll(liquidityProvider.address);
    await token1.burnAll(liquidityProvider.address);
  }

  async function liquidityProviderBalance() {
    return {
      token0: await token0.balanceOf(liquidityProvider.address),
      token1: await token1.balanceOf(liquidityProvider.address),
      balance: await liquidityProvider.getBalance("latest"),
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

  function withInPrecision(
    price0: BigNumber,
    price1: BigNumber,
    precision: number
  ) {
    const base = BigNumber.from(10).pow(precision);
    const value = base.sub(price0.mul(base).div(price1)).abs();
    return value.lte(1);
  }

  async function mintPosition(
    lowerTick: number,
    upperTick: number,
    multiplier: number
  ) {
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
      owner: await poolManager.ownerOf(positionId),
      token0: amountDesired.sub(
        await token0.balanceOf(liquidityProvider.address)
      ),
      token1: amountDesired.sub(
        await token1.balanceOf(liquidityProvider.address)
      ),
    };
  }

  async function mintNativePosition(
    lowerTick: number,
    upperTick: number,
    multiplier: number
  ) {
    const amountDesired = ethers.utils.parseEther("100").mul(multiplier);

    await clearBalance();

    await token0.mint(liquidityProvider.address, amountDesired);
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amountDesired);

    const beforeBalance = await liquidityProvider.getBalance();
    const tx = await poolManager
      .connect(liquidityProvider)
      .mintNative(
        nativePool.address,
        lowerTick,
        lowerTick,
        upperTick,
        upperTick,
        amountDesired,
        0,
        0,
        { value: amountDesired }
      );
    const receipt = await tx.wait();
    const afterBalance = await liquidityProvider.getBalance();
    const amountReal = beforeBalance
      .sub(afterBalance)
      .sub(receipt.gasUsed.mul(tx.gasPrice!));

    const count = await poolManager.balanceOf(liquidityProvider.address);
    const positionId = await poolManager.tokenOfOwnerByIndex(
      liquidityProvider.address,
      count.sub(1)
    );
    const liquidity = (await poolManager.positions(positionId)).liquidity;
    return {
      positionId: positionId,
      liquidity: liquidity,
      owner: await poolManager.ownerOf(positionId),
      token0: amountDesired.sub(
        await token0.balanceOf(liquidityProvider.address)
      ),
      token1: amountReal,
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

  describe("# ACCESS CONTROL TEST", async () => {
    it("REVERT CASE ) InvalidSwapFee", async () => {
      await expect(
        masterDeployer.deployPool(
          poolFactory.address,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24", "address"],
            [
              token0.address,
              token1.address,
              BigNumber.from(100001),
              TWO_POW_96,
              BigNumber.from(TICK_SPACING),
              ethers.constants.AddressZero,
            ]
          )
        )
      ).to.be.reverted;
    });

    it("REVERT CASE ) token = address(0)", async () => {
      await expect(
        masterDeployer.deployPool(
          poolFactory.address,
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              ethers.constants.AddressZero,
              token1.address,
              BigNumber.from(SWAP_FEE),
              TWO_POW_96,
              BigNumber.from(TICK_SPACING),
            ]
          )
        )
      ).to.be.reverted;
    });

    it("REVERT CASE ) Pool:setPrice", async () => {
      await expect(pool.setPrice(0)).to.be.reverted;
    });

    it("REVERT CASE ) Pool:registerLogger", async () => {
      await expect(pool.registerLogger(trader.address)).to.be.reverted;
    });

    it("REVERT CASE ) setDescriptor", async () => {
      await expect(poolManager.connect(trader).setDescriptor(trader.address)).to
        .be.reverted;
    });

    it("REVERT CASE ) mint to invalid pool", async () => {
      await expect(
        poolManager
          .connect(liquidityProvider)
          .mint(
            liquidityProvider.address,
            -10,
            -10,
            10,
            10,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            0,
            0
          )
      ).to.be.reverted;
    });

    it("REVERT CASE ) mintNative to invalid pool", async () => {
      await expect(
        poolManager
          .connect(liquidityProvider)
          .mintNative(
            liquidityProvider.address,
            -10,
            -10,
            10,
            10,
            ethers.utils.parseEther("1"),
            0,
            0,
            { value: ethers.utils.parseEther("1") }
          )
      ).to.be.reverted;
    });

    it("REVERT CASE ) try to call mintCallback directly", async () => {
      await expect(
        poolManager
          .connect(liquidityProvider)
          .mintCallback(
            token0.address,
            token1.address,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          )
      ).to.be.reverted;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * TEST 1)
   * LP X3                          <--------------------------->
   * TEST 2)
   * LP X3          <------------------->
   * TEST 3)
   * LP X3                                                  <------------------->
   */
  describe("# MULTIPLE MINT CASE", async () => {
    it("REVERT CASE : TOO_LITTLE_RECEIVED", async () => {
      const amountDesired = ethers.utils.parseEther("100");
      const lowerTick = -4 * TICK_SPACING;
      const upperTick = 3 * TICK_SPACING;

      await clearBalance();
      const liquidity = await positionHelper.getLiquidityForAmounts(
        pool.address,
        lowerTick,
        upperTick,
        amountDesired,
        amountDesired
      );

      await token0.mint(liquidityProvider.address, amountDesired);
      await token0
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired);

      await token1.mint(liquidityProvider.address, amountDesired);
      await token1
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired);
      await expect(
        poolManager
          .connect(liquidityProvider)
          .mint(
            pool.address,
            lowerTick,
            lowerTick,
            upperTick,
            upperTick,
            amountDesired,
            amountDesired,
            liquidity.add(1),
            0
          )
      ).to.be.reverted;

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
          liquidity,
          0
        );
    });

    it("REVERT CASE : mint Overflow", async () => {
      const amountDesired = BigNumber.from(2).pow(128).sub(1);
      const lowerTick = -2 * TICK_SPACING;
      const upperTick = 1 * TICK_SPACING;

      await clearBalance();
      await token0.mint(liquidityProvider.address, amountDesired.mul(2));
      await token0
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired.mul(2));

      await token1.mint(liquidityProvider.address, amountDesired.mul(2));
      await token1
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired.mul(2));

      // THEN
      await expect(
        poolManager
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
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : lower InvalidTick", async () => {
      await expect(
        pool.mint({
          lowerOld: -887272,
          lower: -4 * TICK_SPACING - 1,
          upperOld: -4 * TICK_SPACING,
          upper: 3 * TICK_SPACING,
          amount0Desired: ethers.utils.parseEther("1"),
          amount1Desired: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("InvalidTick");
    });

    it("REVERT CASE : upper InvalidTick", async () => {
      await expect(
        pool.mint({
          lowerOld: -887272,
          lower: -4 * TICK_SPACING,
          upperOld: -4 * TICK_SPACING,
          upper: 3 * TICK_SPACING + 1,
          amount0Desired: ethers.utils.parseEther("1"),
          amount1Desired: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("InvalidTick");
    });

    it("REVERT CASE : lower evenTick", async () => {
      await expect(
        pool.mint({
          lowerOld: -887272,
          lower: -3 * TICK_SPACING,
          upperOld: -3 * TICK_SPACING,
          upper: 3 * TICK_SPACING,
          amount0Desired: ethers.utils.parseEther("1"),
          amount1Desired: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("LowerEven");
    });

    it("REVERT CASE : lower oddTick", async () => {
      await expect(
        pool.mint({
          lowerOld: -887272,
          lower: -4 * TICK_SPACING,
          upperOld: -4 * TICK_SPACING,
          upper: 2 * TICK_SPACING,
          amount0Desired: ethers.utils.parseEther("1"),
          amount1Desired: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("UpperOdd");
    });

    it("REVERT CASE : LiquidityOverflow", async () => {
      const amountDesired = BigNumber.from(2).pow(110).sub(1);
      const lowerTick = -2 * TICK_SPACING;
      const upperTick = 1 * TICK_SPACING;

      const value = await positionHelper.getLiquidityForAmounts(
        pool.address,
        lowerTick,
        upperTick,
        amountDesired,
        amountDesired
      );

      await clearBalance();
      await token0.mint(liquidityProvider.address, amountDesired.mul(2));
      await token0
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired.mul(2));

      await token1.mint(liquidityProvider.address, amountDesired.mul(2));
      await token1
        .connect(liquidityProvider)
        .approve(poolManager.address, amountDesired.mul(2));

      // THEN
      await expect(
        poolManager
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
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : NOT OWNER", async () => {
      // GIVEN
      const amountDesired = ethers.utils.parseEther("10");

      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await token0.mint(trader.address, amountDesired);
      await token0.connect(trader).approve(poolManager.address, amountDesired);

      await token1.mint(trader.address, amountDesired);
      await token1.connect(trader).approve(poolManager.address, amountDesired);

      // WHEN
      await expect(
        poolManager
          .connect(trader)
          .mint(
            pool.address,
            -4 * TICK_SPACING,
            -4 * TICK_SPACING,
            3 * TICK_SPACING,
            3 * TICK_SPACING,
            amountDesired,
            amountDesired,
            0,
            case1.positionId
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : RANGE MISMATCH", async () => {
      // GIVEN
      const amountDesired = ethers.utils.parseEther("10");

      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await token0.mint(trader.address, amountDesired);
      await token0.connect(trader).approve(poolManager.address, amountDesired);

      await token1.mint(trader.address, amountDesired);
      await token1.connect(trader).approve(poolManager.address, amountDesired);

      // WHEN
      await expect(
        poolManager
          .connect(trader)
          .mint(
            pool.address,
            -4 * TICK_SPACING,
            -4 * TICK_SPACING,
            3 * TICK_SPACING,
            7 * TICK_SPACING,
            amountDesired,
            amountDesired,
            0,
            case1.positionId
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : BURN BY NOT OWNER", async () => {
      // GIVEN
      const result = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);

      // WHEN
      await expect(
        poolManager
          .connect(trader)
          .burn(
            result.positionId,
            result.liquidity,
            liquidityProvider.address,
            0,
            0,
            false
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : BURN Too Little Received", async () => {
      // GIVEN
      const result = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);

      const amounts = await positionHelper.getAmountsForLiquidity(
        result.positionId,
        result.liquidity
      );

      // WHEN
      await expect(
        poolManager
          .connect(liquidityProvider)
          .burn(
            result.positionId,
            result.liquidity,
            liquidityProvider.address,
            amounts.token0amount.add(1),
            amounts.token1amount,
            false
          )
      ).to.be.reverted;

      await expect(
        poolManager
          .connect(liquidityProvider)
          .burn(
            result.positionId,
            result.liquidity,
            liquidityProvider.address,
            amounts.token0amount,
            amounts.token1amount.add(1),
            false
          )
      ).to.be.reverted;
    });

    it("REVERT CASE : BURN TO KLIP DEAD ADDRESS", async () => {
      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      await expect(
        poolManager
          .connect(liquidityProvider)
          .transferFrom(
            liquidityProvider.address,
            "0x000000000000000000000000000000000000dEaD",
            case1.positionId
          )
      ).to.be.revertedWith("ERC721: transfer to the klip DEAD address");
    });

    it("TEST 1)", async () => {
      // GIVEN
      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const case2 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 2);
      const case3 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          case1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case1.token0, 18)).to.be.true;
      expect(withInPrecision(balance.token1, case1.token1, 18)).to.be.true;

      // LP2 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case2.positionId,
          case2.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case2.token0, 18)).to.be.true;
      expect(withInPrecision(balance.token1, case2.token1, 18)).to.be.true;

      // LP3 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case3.positionId,
          case3.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case3.token0, 18)).to.be.true;
      expect(withInPrecision(balance.token1, case3.token1, 18)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const case1 = await mintPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 1);
      const case2 = await mintPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 2);
      const case3 = await mintPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          case1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token1, case1.token1, 18)).to.be.true;

      // LP2 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case2.positionId,
          case2.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token1, case2.token1, 18)).to.be.true;

      // LP3 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case3.positionId,
          case3.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token1, case3.token1, 18)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const case1 = await mintPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 1);
      const case2 = await mintPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 2);
      const case3 = await mintPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          case1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case1.token0, 18)).to.be.true;

      // LP2 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case2.positionId,
          case2.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case2.token0, 18)).to.be.true;

      // LP3 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case3.positionId,
          case3.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case3.token0, 18)).to.be.true;
    });

    it("TEST 4)", async () => {
      // GIVEN
      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const case2 = await mintPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 2);
      const case3 = await mintPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          case1.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case1.token0, 18)).to.be.true;
      expect(withInPrecision(balance.token1, case1.token1, 18)).to.be.true;

      // LP2 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case2.positionId,
          case2.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token1, case2.token1, 18)).to.be.true;

      // LP3 BURN
      await clearBalance();
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case3.positionId,
          case3.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case3.token0, 18)).to.be.true;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * TEST 1)
   * LP X3                          <--------------------------->
   * TEST 2)
   * LP X3          <------------------->
   * TEST 3)
   * LP X3                                                  <------------------->
   */
  describe("# ADD LIQUIDITY (NOT MINT) ON SAME POSITION CASE", async () => {
    it("TEST 1)", async () => {
      // GIVEN
      const case1 = await mintPosition(-4 * TICK_SPACING, 3 * TICK_SPACING, 1);
      const case2 = await addLiquidity(case1.positionId, 2);
      const case3 = await addLiquidity(case1.positionId, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      const totalLiquidity = case1.liquidity
        .add(case2.liquidity)
        .add(case3.liquidity);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          totalLiquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      let expect0Amount = case1.token0.add(case2.token0).add(case3.token0);
      let expect1Amount = case1.token1.add(case2.token1).add(case3.token1);

      expect(withInPrecision(balance.token0, expect0Amount, 18)).to.be.true;
      expect(withInPrecision(balance.token1, expect1Amount, 18)).to.be.true;
    });

    it("TEST 2)", async () => {
      // GIVEN
      const case1 = await mintPosition(-8 * TICK_SPACING, -3 * TICK_SPACING, 1);
      const case2 = await addLiquidity(case1.positionId, 2);
      const case3 = await addLiquidity(case1.positionId, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      const totalLiquidity = case1.liquidity
        .add(case2.liquidity)
        .add(case3.liquidity);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          totalLiquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      let expect1Amount = case1.token1.add(case2.token1).add(case3.token1);

      expect(withInPrecision(balance.token1, expect1Amount, 18)).to.be.true;
    });

    it("TEST 3)", async () => {
      // GIVEN
      const case1 = await mintPosition(2 * TICK_SPACING, 7 * TICK_SPACING, 1);
      const case2 = await addLiquidity(case1.positionId, 2);
      const case3 = await addLiquidity(case1.positionId, 3);
      await clearBalance();

      // WHEN
      // LP1 BURN
      const totalLiquidity = case1.liquidity
        .add(case2.liquidity)
        .add(case3.liquidity);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          totalLiquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      let balance = await liquidityProviderBalance();
      let expect0Amount = case1.token0.add(case2.token0).add(case3.token0);

      expect(withInPrecision(balance.token0, expect0Amount, 18)).to.be.true;
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * GIVEN
   *   LP MINT                      <--------------------------->
   *   SWAP (FEE add)
   *
   * THEN
   *   TEST 1) LP BURN (Partial) => only lp tokens
   *   TEST 2) LP BURN (Full) => lp tokens &

   */
  describe(" (ADD & REMOVE LIQUIDITY) => CHECK FEE CASE", async () => {
    it("revert case ) Not Owner", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );
      await swapToken1ToToken0(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );

      await expect(
        poolManager
          .connect(trader)
          .collect(position.positionId, liquidityProvider.address, false)
      ).to.be.reverted;
    });

    it("TEST 1) LP Burn Partial", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );
      await swapToken1ToToken0(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );

      const expectedFee = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(
          position.positionId,
          liquidityProvider.address,
          false
        );

      // WHEN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity.div(2),
          liquidityProvider.address,
          0,
          0,
          false
        );

      // THEN
      const result = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(
          position.positionId,
          liquidityProvider.address,
          false
        );

      expect(expectedFee[0]).to.be.eq(result[0]);
      expect(expectedFee[1]).to.be.eq(result[1]);
    });

    it("TEST 2) LP Burn Full => collect fee all", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );
      await swapToken1ToToken0(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );

      const expectedFee = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(
          position.positionId,
          liquidityProvider.address,
          false
        );

      // WHEN
      await clearBalance();
      const expectedLp = await poolManager
        .connect(liquidityProvider)
        .callStatic.burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );

      // THEN
      const userBalance = await liquidityProviderBalance();

      expect(userBalance.token0).to.be.eq(expectedLp[0].add(expectedFee[0]));
      expect(userBalance.token1).to.be.eq(expectedLp[1].add(expectedFee[1]));
    });

    it("TEST 3) LP Mint Partial", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );
      await swapToken1ToToken0(
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("0")
      );

      const expectedFee = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(
          position.positionId,
          liquidityProvider.address,
          false
        );

      // WHEN
      await addLiquidity(position.positionId, 1);

      // THEN
      const result = await poolManager
        .connect(liquidityProvider)
        .callStatic.collect(
          position.positionId,
          liquidityProvider.address,
          false
        );

      expect(expectedFee[0]).to.be.eq(result[0]);
      expect(expectedFee[1]).to.be.eq(result[1]);
    });

    it("TEST 4) Swap To Minimum Price", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );

      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );

      const total = await dashboard.getTotal(
        poolManager.address,
        position.positionId
      );

      const before0 = await token0.balanceOf(liquidityProvider.address);
      const before1 = await token1.balanceOf(liquidityProvider.address);
      // WHEN
      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );
      const after0 = await token0.balanceOf(liquidityProvider.address);
      const after1 = await token1.balanceOf(liquidityProvider.address);
      expect(total.amount0).to.be.eq(after0.sub(before0));
      expect(total.amount1).to.be.eq(after1.sub(before1));

      const [reserve0, reserve1] = await pool.getReserves();
      const [fee0, fee1] = await pool.getTokenProtocolFees();
      expect(reserve0).to.be.closeTo(fee0, 1000);
      expect(reserve1).to.be.closeTo(fee1, 1000);
    });

    it("TEST 5) Swap To Maximum Price", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken1ToToken0(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );
      const total = await dashboard.getTotal(
        poolManager.address,
        position.positionId
      );

      // WHEN
      const before0 = await token0.balanceOf(liquidityProvider.address);
      const before1 = await token1.balanceOf(liquidityProvider.address);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );
      const after0 = await token0.balanceOf(liquidityProvider.address);
      const after1 = await token1.balanceOf(liquidityProvider.address);
      expect(total.amount0).to.be.eq(after0.sub(before0));
      expect(total.amount1).to.be.eq(after1.sub(before1));

      const [reserve0, reserve1] = await pool.getReserves();
      const [fee0, fee1] = await pool.getTokenProtocolFees();
      expect(reserve0).to.be.closeTo(fee0, 1000);
      expect(reserve1).to.be.closeTo(fee1, 1000);
    });

    it("TEST 6) Swap From Minimum Price to Maximum Price", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken0ToToken1(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );

      await swapToken1ToToken0(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );
      const total = await dashboard.getTotal(
        poolManager.address,
        position.positionId
      );

      // WHEN
      const before0 = await token0.balanceOf(liquidityProvider.address);
      const before1 = await token1.balanceOf(liquidityProvider.address);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );
      const after0 = await token0.balanceOf(liquidityProvider.address);
      const after1 = await token1.balanceOf(liquidityProvider.address);
      expect(total.amount0).to.be.eq(after0.sub(before0));
      expect(total.amount1).to.be.eq(after1.sub(before1));

      const [reserve0, reserve1] = await pool.getReserves();
      const [fee0, fee1] = await pool.getTokenProtocolFees();
      expect(reserve0).to.be.closeTo(fee0, 1000);
      expect(reserve1).to.be.closeTo(fee1, 1000);
    });

    it("TEST 7) Swap From Minimum Price to Maximum Price", async () => {
      // GIVEN
      const position = await mintPosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      // swap event for fee collecting
      await swapToken1ToToken0(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );
      await swapToken0ToToken1(
        ethers.utils.parseEther("1000000"),
        ethers.utils.parseEther("0")
      );
      const total = await dashboard.getTotal(
        poolManager.address,
        position.positionId
      );

      // WHEN
      const before0 = await token0.balanceOf(liquidityProvider.address);
      const before1 = await token1.balanceOf(liquidityProvider.address);
      await poolManager
        .connect(liquidityProvider)
        .burn(
          position.positionId,
          position.liquidity,
          liquidityProvider.address,
          0,
          0,
          false
        );
      const after0 = await token0.balanceOf(liquidityProvider.address);
      const after1 = await token1.balanceOf(liquidityProvider.address);
      expect(total.amount0).to.be.eq(after0.sub(before0));
      expect(total.amount1).to.be.eq(after1.sub(before1));

      const [reserve0, reserve1] = await pool.getReserves();
      const [fee0, fee1] = await pool.getTokenProtocolFees();
      expect(reserve0).to.be.closeTo(fee0, 1000);
      expect(reserve1).to.be.closeTo(fee1, 1000);
    });
  });

  /*
   * |---------------------|
   * | SWAP FEE     : 2000 |
   * | TICK SPACING :   40 |
   * |---------------------|
   *                                         CURRENT PRICE
   *                                                |
   *   -11 -10 -9  -8  -7  -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6   7   8   9  10  11
   * ---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---
   *
   * TEST 1)
   * LP                             <--------------------------->
   */
  describe("# MINT & BURN NATIVE CASE", async () => {
    it("TEST 1)", async () => {
      // GIVEN
      const case1 = await mintNativePosition(
        -4 * TICK_SPACING,
        3 * TICK_SPACING,
        1
      );
      await clearBalance();

      // WHEN
      // LP1 BURN
      let before = await liquidityProviderBalance();
      let tx = await poolManager
        .connect(liquidityProvider)
        .burn(
          case1.positionId,
          case1.liquidity,
          liquidityProvider.address,
          0,
          0,
          true
        );
      let receipt = await tx.wait();
      let after = await liquidityProviderBalance();
      let receivedValue = after.balance
        .sub(before.balance)
        .add(receipt.gasUsed.mul(tx.gasPrice!));

      let balance = await liquidityProviderBalance();
      expect(withInPrecision(balance.token0, case1.token0, 18)).to.be.true;
      expect(withInPrecision(receivedValue, case1.token1, 18)).to.be.true;
    });
  });
});
