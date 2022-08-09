import { ethers, network } from "hardhat";
import {
  ERC20Test,
  FlashCallbackMock,
  MasterDeployer,
  RewardLiquidityPool,
  RewardLiquidityPoolFactory,
  RewardLiquidityPoolManager,
  WETH10,
} from "../../../types";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { sortTokens } from "../../harness/utils";
import { describe } from "mocha";
import { RewardPangea } from "./RewardPangea";
import { expect } from "chai";

/**
 * Test for FLASH in Concentrated Liquidity Pool
 */
describe("Reward Liquidity Pool SCENARIO:FLASH", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 2000; // 0.2%
  const TICK_SPACING = 40;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;

  let pangea: RewardPangea;
  let wklay: WETH10;
  let masterDeployer: MasterDeployer;
  let poolManager: RewardLiquidityPoolManager;
  let poolFactory: RewardLiquidityPoolFactory;
  let pool: RewardLiquidityPool;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let rewardToken: ERC20Test;

  let callback: FlashCallbackMock;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await RewardPangea.Instance.init();
    wklay = pangea.weth;
    masterDeployer = pangea.masterDeployer;
    poolManager = pangea.concentratedPoolManager;
    poolFactory = pangea.concentratedPoolFactory;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    rewardToken = (await Token.deploy("Reward", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableFeeAndTickSpacing(
      SWAP_FEE,
      TICK_SPACING,
      true
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
              BigNumber.from(TICK_SPACING)
            ]
        )
    );

    const poolAddress = (
      await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<RewardLiquidityPool>(
      "RewardLiquidityPool",
      poolAddress
    );

    callback = (await (
      await ethers.getContractFactory("FlashCallbackMock")
    ).deploy(poolAddress)) as FlashCallbackMock;

    await token0.mint(callback.address, ethers.utils.parseEther("100000"));
    await token1.mint(callback.address, ethers.utils.parseEther("100000"));

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

  async function addLiquidity(lowerTick: number, upperTick: number) {
    const amount0Desired = ethers.utils.parseEther("100");
    await token0.mint(liquidityProvider.address, amount0Desired.mul(4));
    await token0
      .connect(liquidityProvider)
      .approve(poolManager.address, amount0Desired.mul(4));

    const amount1Desired = ethers.utils.parseEther("100");
    await token1.mint(liquidityProvider.address, amount1Desired.mul(4));
    await token1
      .connect(liquidityProvider)
      .approve(poolManager.address, amount1Desired.mul(4));
    await poolManager
      .connect(liquidityProvider)
      .mint(
        pool.address,
        lowerTick,
        lowerTick,
        upperTick,
        upperTick,
        amount0Desired,
        amount1Desired,
        0,
        0
      );
  }

  describe("ABNORMAL FLASH CASE", async () => {
    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
    });

    it("REVERT CASE 1) amount0 to flash > reserve0 in pool", async () => {
      // GIVEN
      const [reserve0, reserve1] = await pool.getReserves();

      // WHEN
      await expect(
        callback.callFlash(
          reserve0.add(1),
          reserve1,
          ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [0, 0])
        )
      ).to.be.reverted;
    });

    it("REVERT CASE 2) amount1 to flash > reserve1 in pool", async () => {
      // GIVEN
      const [reserve0, reserve1] = await pool.getReserves();

      // WHEN
      await expect(
        callback.callFlash(
          reserve0,
          reserve1.add(1),
          ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [0, 0])
        )
      ).to.be.reverted;
    });
  });

  describe("FLASH CASE", async () => {
    beforeEach("deploy PositionPool", async () => {
      await addLiquidity(-4 * TICK_SPACING, 3 * TICK_SPACING);
    });

    it("CASE 1) (token0Missing) flash amount0 but insufficient fee", async () => {
      // GIVEN
      const [reserve0] = await pool.getReserves();
      const amount0 = reserve0.div(2);
      const flashFee0 = amount0
        .mul(await pool.swapFee())
        .div(BigNumber.from(10).pow(6));

      // WHEN
      await expect(
        callback.callFlash(
          amount0,
          0,
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "uint256"],
            [flashFee0.sub(1), 0]
          )
        )
      ).to.be.revertedWith("Token0Missing");
    });

    it("CASE 2) (token1Missing) flash amount1 but insufficient fee", async () => {
      // GIVEN
      const [, reserve1] = await pool.getReserves();
      const amount1 = reserve1.div(2);
      const flashFee1 = amount1
        .mul(await pool.swapFee())
        .div(BigNumber.from(10).pow(6));

      // WHEN
      await expect(
        callback.callFlash(
          0,
          amount1,
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "uint256"],
            [0, flashFee1.sub(1)]
          )
        )
      ).to.be.reverted;
    });

    it("CASE 3) flash amount0 success", async () => {
      // GIVEN
      const [reserve0] = await pool.getReserves();
      const amount0 = reserve0.div(2);
      const flashFee0 = amount0
        .mul(await pool.swapFee())
        .div(BigNumber.from(10).pow(6))
        .add(1);
      const beforeBalance = await token0.balanceOf(callback.address);

      // WHEN
      await callback.callFlash(
        amount0,
        0,
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256"],
          [flashFee0, 0]
        )
      );

      // THEN
      const [afterReserve0] = await pool.getReserves();
      const afterBalance = await token0.balanceOf(callback.address);
      const [token0ProtocolFee] = await pool.getTokenProtocolFees();
      const swapFeeGrowthGlobal0 = await pool.feeGrowthGlobal0();
      const token0SwapFee = swapFeeGrowthGlobal0
        .mul(await pool.liquidity())
        .div(BigNumber.from(2).pow(128));
      const fee0Total = token0ProtocolFee.add(token0SwapFee);

      expect(fee0Total.sub(flashFee0).abs()).lte(2);
      expect(beforeBalance.sub(afterBalance)).to.be.eq(flashFee0);
      expect(reserve0.add(flashFee0)).to.be.eq(afterReserve0);
    });

    it("CASE 4) flash amount1 success", async () => {
      // GIVEN
      const [, reserve1] = await pool.getReserves();
      const amount1 = reserve1.div(3);
      const flashFee1 = amount1
        .mul(await pool.swapFee())
        .div(BigNumber.from(10).pow(6))
        .add(1);
      const beforeBalance = await token1.balanceOf(callback.address);

      // WHEN
      await callback.callFlash(
        0,
        amount1,
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "uint256"],
          [0, flashFee1]
        )
      );

      // THEN
      const [, afterReserve1] = await pool.getReserves();
      const afterBalance = await token1.balanceOf(callback.address);
      const [, token1ProtocolFee] = await pool.getTokenProtocolFees();
      const swapFeeGrowthGlobal1 = await pool.feeGrowthGlobal1();
      const token1SwapFee = swapFeeGrowthGlobal1
        .mul(await pool.liquidity())
        .div(BigNumber.from(2).pow(128));
      const fee1Total = token1ProtocolFee.add(token1SwapFee);

      expect(fee1Total.sub(flashFee1).abs()).lte(2);
      expect(beforeBalance.sub(afterBalance)).to.be.eq(flashFee1);
      expect(reserve1.add(flashFee1)).to.be.eq(afterReserve1);
    });
  });
});
