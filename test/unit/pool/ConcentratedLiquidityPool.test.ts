import { BigNumber } from "@ethersproject/bignumber";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  addLiquidityViaManager,
  removeLiquidityViaManager,
  collectFees,
  collectProtocolFee,
  getDx,
  getDy,
  getTickAtCurrentPrice,
  LinkedListHelper,
  swapViaRouter,
} from "../../harness/Concentrated";
import { getBigNumber } from "../../harness/helpers";
import { Pangea } from "../../harness/pangea";

describe("Concentrated Liquidity Product Pool", function () {
  let _snapshotId: string;
  let snapshotId: string;
  let pangea: Pangea;
  let defaultAddress: string;
  const helper = new LinkedListHelper(-887272);
  const step = 10800; // 2^5 * 3^2 * 5^2 (nicely divisible number)

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);
    pangea = await Pangea.Instance.init();
    defaultAddress = pangea.accounts[0].address;
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

  describe("Valid actions", async () => {
    it("Should mint liquidity (in / out of range, reusing ticks / new ticks)", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        // assume increasing tick value by one step brings us to a valid tick
        // satisfy "lower even" & "upper odd" conditions
        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(50),
          amount1Desired: getBigNumber(50),
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        // normal mint
        await addLiquidityViaManager(addLiquidityParams);

        // normal mint, narrower range
        addLiquidityParams = helper.setTicks(
          lower + step / 2,
          upper - step / 2,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        // mint on the same lower tick
        // @dev if a tick exists we dont' have to provide the tickOld param
        addLiquidityParams = helper.setTicks(
          lower,
          upper + step,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        // mint on the same upper tick
        addLiquidityParams = helper.setTicks(
          lower - step,
          upper,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        // mint below trading price
        addLiquidityParams = helper.setTicks(
          lower - 2 * step,
          upper - 2 * step,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        // mint above trading price
        addLiquidityParams = helper.setTicks(
          lower + 2 * step,
          upper + 2 * step,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);
      }
    });

    it("should add liquidity", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        await addLiquidityViaManager(addLiquidityParams);
      }
    });

    it("should add liquidity again and mint new NFT", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: 0,
        };

        await addLiquidityViaManager(addLiquidityParams);

        addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: 0,
        };

        await addLiquidityViaManager(addLiquidityParams);
      }
    });

    it("should increase liquidity", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: 0,
        };

        const mint = await addLiquidityViaManager(addLiquidityParams);

        const userPositionMint1 = (
          await pangea.concentratedPoolManager.positions(mint.tokenId)
        ).liquidity;

        addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: mint.tokenId.toNumber(),
        };
        const mint2 = await addLiquidityViaManager(addLiquidityParams);

        const userPositionMint2 = (
          await pangea.concentratedPoolManager.positions(mint.tokenId)
        ).liquidity;

        expect(userPositionMint1.add(mint2.liquidity)).to.be.eq(
          userPositionMint2
        );
      }
    });

    it("Should add liquidity and swap (without crossing)", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        // assume increasing tick value by one step brings us to a valid tick
        // satisfy "lower even" & "upper odd" conditions
        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        await addLiquidityViaManager(addLiquidityParams);

        const lowerPrice = await pangea.tickMath.getSqrtRatioAtTick(lower);
        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const maxDx = await getDx(
          await pool.liquidity(),
          lowerPrice,
          currentPrice,
          false
        );

        // swap back and forth
        const swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: maxDx,
          recipient: defaultAddress,
        });

        await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });
      }
    });

    it("Should add liquidity and swap (with crossing ticks)", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();
        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick - tickSpacing;

        let lower = nearestEvenValidTick - 2 * tickSpacing;
        let upper = nearestEvenValidTick + 3 * tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(100),
          amount1Desired: getBigNumber(100),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        await addLiquidityViaManager(addLiquidityParams);

        addLiquidityParams = helper.setTicks(
          lower - 10 * step,
          upper + 10 * step,
          addLiquidityParams
        );

        const lp = await addLiquidityViaManager(addLiquidityParams);

        // swap accross the range and back
        //                       ▼ - - - - - - -> ▼
        // ----------------|xxxxxxxxxxx|-------------------------------
        // ----|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|-----

        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const upperPrice = await pangea.tickMath.getSqrtRatioAtTick(upper);
        const maxDy = await getDy(
          await pool.liquidity(),
          currentPrice,
          upperPrice,
          false
        );

        let swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: maxDy.mul(2),
          recipient: defaultAddress,
        });
        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });
        // swap accross the range and back
        //                       ▼ - - - - - - -> ▼
        // ----------------|xxxxxxxxxxx|-----|xxxxxxxxxx|--------
        // ------------------------------------------------------
        await removeLiquidityViaManager({
          pool,
          tokenId: lp.tokenId.toNumber(),
          liquidityAmount: lp.liquidity,
          recipient: defaultAddress,
          unwrap: false,
        });
        addLiquidityParams = helper.setTicks(
          lower + 3 * step,
          upper + 5 * step,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });

        await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });
      }
    });

    it("Should add liquidity and swap (with crossing through empty space)", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(100),
          amount1Desired: getBigNumber(100),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        await addLiquidityViaManager(addLiquidityParams);

        addLiquidityParams.amount0Desired =
          addLiquidityParams.amount0Desired.mul(2);
        addLiquidityParams.amount1Desired =
          addLiquidityParams.amount1Desired.mul(2);
        addLiquidityParams = helper.setTicks(
          lower + 3 * step,
          upper + 3 * step,
          addLiquidityParams
        );
        await addLiquidityViaManager(addLiquidityParams);

        // swap accross a zero liquidity range and back
        //                       ▼ - - - - - - - - - -> ▼
        // ----|----|-------|xxxxxxxxxxxx|-------|xxxxxxxxxxx|-----

        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const upperPrice = await pangea.tickMath.getSqrtRatioAtTick(upper);
        const maxDy = await getDy(
          await pool.liquidity(),
          currentPrice,
          upperPrice,
          false
        );

        const swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: maxDy.mul(2),
          recipient: defaultAddress,
        });

        await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });
      }
    });

    it("Should distribute fees correctly", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(100),
          amount1Desired: getBigNumber(100),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        const tokenIdA = (await addLiquidityViaManager(addLiquidityParams))
          .tokenId;

        addLiquidityParams.amount0Desired =
          addLiquidityParams.amount0Desired.mul(2);
        addLiquidityParams.amount1Desired =
          addLiquidityParams.amount1Desired.mul(2);
        const tokenIdB = (await addLiquidityViaManager(addLiquidityParams))
          .tokenId;

        addLiquidityParams = helper.setTicks(
          lower - step * 2,
          upper - step * 2,
          addLiquidityParams
        );
        const tokenIdC = (await addLiquidityViaManager(addLiquidityParams))
          .tokenId;

        // swap within tick
        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const upperPrice = await pangea.tickMath.getSqrtRatioAtTick(upper);
        const maxDy = await getDy(
          await pool.liquidity(),
          currentPrice,
          upperPrice,
          false
        );

        let swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: maxDy,
          recipient: defaultAddress,
        });

        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });

        const positionNewFeeGrowth = await pool.rangeFeeGrowth(lower, upper);
        const globalFeeGrowth0 = await pool.feeGrowthGlobal0();
        const globalFeeGrowth1 = await pool.feeGrowthGlobal1();
        expect(positionNewFeeGrowth.feeGrowthInside0.toString()).to.be.eq(
          globalFeeGrowth0.toString(),
          "Fee growth 0 wasn't accredited to the positions"
        );
        expect(positionNewFeeGrowth.feeGrowthInside1.toString()).to.be.eq(
          globalFeeGrowth1.toString(),
          "Fee growth 1 wasn't accredited to the positions"
        );
        const smallerPositionFees1 = await collectFees({
          pool,
          tokenId: tokenIdA,
          recipient: defaultAddress,
        });

        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });

        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });

        const smallerPositionFees2 = await collectFees({
          pool,
          tokenId: tokenIdA,
          recipient: defaultAddress,
        });
        const smallerPositionFeesDy = smallerPositionFees2.dy.add(
          smallerPositionFees1.dy
        );
        const smallerPositionFeesDx = smallerPositionFees2.dx.add(
          smallerPositionFees1.dx
        );
        const biggerPositionFees = await collectFees({
          pool,
          tokenId: tokenIdB,
          recipient: defaultAddress,
        });
        const outsidePositionFees = await collectFees({
          pool,
          tokenId: tokenIdC,
          recipient: defaultAddress,
        });
        const ratioY = smallerPositionFeesDy
          .mul(1e6)
          .div(biggerPositionFees.dy.div(2));
        const ratioX = smallerPositionFeesDx
          .mul(1e6)
          .div(biggerPositionFees.dx.div(2));
        // allow for small rounding errors that happen when users claim on different intervals
        expect(
          ratioY.lt(1000100) && ratioY.lt(999900),
          "fees 1 weren't proportionally split"
        );
        expect(
          ratioX.lt(1000100) && ratioX.lt(999900),
          "fees 0 weren't proportionally split"
        );
        expect(outsidePositionFees.dy.toString()).to.be.eq(
          "0",
          "fees were acredited to a position not in range"
        );
      }
    });

    it("Should distribute fees correctly after crossing ticks", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        const lower = nearestEvenValidTick - step;
        const upper = nearestEvenValidTick + step + tickSpacing;
        const lower1 = nearestEvenValidTick + step;
        const upper1 = nearestEvenValidTick + step * 2 + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(200),
          amount1Desired: getBigNumber(200),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        // in range liquiditiy addition
        (await addLiquidityViaManager(addLiquidityParams)).tokenId;

        addLiquidityParams = helper.setTicks(
          nearestEvenValidTick + step + tickSpacing + tickSpacing,
          nearestEvenValidTick + step * 2 + tickSpacing,
          addLiquidityParams
        );
        addLiquidityParams.amount1Desired = getBigNumber("0");
        // out of range (1 sided) liq addition
        (await addLiquidityViaManager(addLiquidityParams)).tokenId;
        // swap within tick
        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const upperPrice = await pangea.tickMath.getSqrtRatioAtTick(upper);
        const lowerPrice = await pangea.tickMath.getSqrtRatioAtTick(lower);
        const maxDx = await getDx(
          await pool.liquidity(),
          lowerPrice,
          currentPrice,
          false
        );
        const feeGrowthGlobal0_init = await pool.feeGrowthGlobal0();
        const feeGrowthGlobal1_init = await pool.feeGrowthGlobal1();

        let swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: maxDx,
          recipient: defaultAddress,
        });

        const positionNewFeeGrowth = await pool.rangeFeeGrowth(lower, upper);
        const feeGrowthGlobal0 = await pool.feeGrowthGlobal0();
        const feeGrowthGlobal1 = await pool.feeGrowthGlobal1();

        expect(feeGrowthGlobal0.eq(feeGrowthGlobal0_init)).to.be.eq(
          true,
          "accreddited fees for the wrong token"
        );
        expect(feeGrowthGlobal1.gt(feeGrowthGlobal1_init)).to.be.eq(
          true,
          "didn't take fees"
        );
        expect(positionNewFeeGrowth.feeGrowthInside0.toString()).to.be.eq(
          feeGrowthGlobal0.toString(),
          "Fee growth 0 wasn't accredited to the positions"
        );
        expect(positionNewFeeGrowth.feeGrowthInside1.toString()).to.be.eq(
          feeGrowthGlobal1.toString(),
          "Fee growth 1 wasn't accredited to the positions"
        );

        // now trade out of the current range and check if the range still has the correct amount of fees credited
        const maxDy = await getDy(
          await pool.liquidity(),
          (
            await pool.getPriceAndNearestTicks()
          )._price,
          upperPrice,
          false
        );

        swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: maxDy.mul(2),
          recipient: defaultAddress,
        });

        const newPrice = (await pool.getPriceAndNearestTicks())._price;
        const upper1Price = await pangea.tickMath.getSqrtRatioAtTick(upper1);

        expect(newPrice.gt(upperPrice)).to.be.true;
        expect(newPrice.lt(upper1Price)).to.be.true; // ensure we crossed out of the initial range

        const positionNewFeeGrowth_end = await pool.rangeFeeGrowth(
          lower,
          upper
        );
        const feeGrowthGlobal0_end = await pool.feeGrowthGlobal0();
        const feeGrowthGlobal1_end = await pool.feeGrowthGlobal1();

        expect(feeGrowthGlobal0_end.gt(feeGrowthGlobal0)).to.be.eq(
          true,
          "accredited fees for the wrong token"
        );
        expect(feeGrowthGlobal1_end.eq(feeGrowthGlobal1)).to.be.eq(
          true,
          "didn't take fees"
        );
        expect(
          positionNewFeeGrowth_end.feeGrowthInside0.gt(
            positionNewFeeGrowth.feeGrowthInside0
          )
        ).to.be.eq(true, "didn't account for token1 fees");
        expect(positionNewFeeGrowth_end.feeGrowthInside1.toString()).to.be.eq(
          positionNewFeeGrowth.feeGrowthInside1.toString(),
          "position fee growth 1 isn't persistent"
        );
      }
    });

    it("Should collect protocolFee", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const immutables = await pool.getImmutables();
        const tickSpacing = immutables._tickSpacing;
        const token0 = immutables._token0;
        const token1 = immutables._token1;
        const protocolFeeTo = await pangea.masterDeployer.protocolFeeTo();
        const oldBarFeeToBalance = await Pangea.Instance.getTokenBalance(
          [token0, token1],
          protocolFeeTo
        );
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        // assume increasing tick value by one step brings us to a valid tick
        // satisfy "lower even" & "upper odd" conditions
        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          native: false,
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        await addLiquidityViaManager(addLiquidityParams);

        const lowerPrice = await pangea.tickMath.getSqrtRatioAtTick(lower);
        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const maxDx = await getDx(
          await pool.liquidity(),
          lowerPrice,
          currentPrice,
          false
        );

        // swap back and forth
        const swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: maxDx,
          recipient: defaultAddress,
        });

        await swapViaRouter({
          pool: pool,
          zeroForOne: false,
          inAmount: swapTx.output,
          recipient: defaultAddress,
        });

        const { token0ProtocolFee, token1ProtocolFee } =
          await collectProtocolFee({ pool: pool });
        const newBarFeeToBalance = await Pangea.Instance.getTokenBalance(
          [token0, token1],
          protocolFeeTo
        );

        expect(newBarFeeToBalance[0].toString()).to.be.eq(
          oldBarFeeToBalance[0].add(token0ProtocolFee),
          "didn't send the correct amount of token0 protocol fee to bar fee to"
        );
        expect(newBarFeeToBalance[1].toString()).to.be.eq(
          oldBarFeeToBalance[1].add(token1ProtocolFee),
          "didn't send the correct amount of token0 protocol fee to bar fee to"
        );
      }
    });

    it("Should burn the position and receive tokens back", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(100),
          amount1Desired: getBigNumber(100),
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
        };

        const mint = await addLiquidityViaManager(addLiquidityParams);
        const userLiquidity = (
          await pangea.concentratedPoolManager.positions(mint.tokenId)
        ).liquidity;
        const userLiquidityPartial = userLiquidity.sub(userLiquidity.div(3));

        let removeLiquidityParams = {
          pool: pool,
          tokenId: Number(mint.tokenId.toString()),
          liquidityAmount: userLiquidityPartial,
          recipient: pangea.accounts[0].address,
          unwrap: false,
        };
        await removeLiquidityViaManager(removeLiquidityParams);
        removeLiquidityParams.liquidityAmount =
          userLiquidity.sub(userLiquidityPartial);
        await removeLiquidityViaManager(removeLiquidityParams);
      }
    });
  });

  describe("Invalid actions", async () => {
    it("Should fail to mint with incorrect parameters for liquidityZero", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();
        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        // INVALID_TICK (LOWER)
        let lower = nearestEvenValidTick - step + 1;
        let upper = nearestEvenValidTick + step + tickSpacing;
        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(50),
          amount1Desired: getBigNumber(50),
          lowerOld: helper.insert(lower),
          lower: nearestEvenValidTick - step + 1,
          upperOld: helper.insert(upper),
          upper: nearestEvenValidTick + step + tickSpacing,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: pangea.accounts[0].address,
        };

        addLiquidityParams.amount0Desired = BigNumber.from(0);
        addLiquidityParams.amount1Desired = BigNumber.from(0);
        addLiquidityParams.lower = nearestEvenValidTick - step;
        addLiquidityParams.upper = nearestEvenValidTick + step + tickSpacing;
        addLiquidityParams.lowerOld = helper.insert(addLiquidityParams.lower);
        addLiquidityParams.upperOld = helper.insert(addLiquidityParams.upper);
        await expect(
          addLiquidityViaManager(addLiquidityParams)
        ).to.be.revertedWith("LiquidityZero");
      }
    });

    it("should not increase liquidity if token id is wrong", async () => {
      for (const pool of pangea.concentratedPools) {
        helper.reset();

        const tickSpacing = (await pool.getImmutables())._tickSpacing;
        const tickAtPrice = await getTickAtCurrentPrice(pool);
        const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
        const nearestEvenValidTick =
          (nearestValidTick / tickSpacing) % 2 == 0
            ? nearestValidTick
            : nearestValidTick + tickSpacing;

        let lower = nearestEvenValidTick - step;
        let upper = nearestEvenValidTick + step + tickSpacing;

        let addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: 0,
        };

        const mint = await addLiquidityViaManager(addLiquidityParams);

        const userPositionMint1 = (
          await pangea.concentratedPoolManager.positions(mint.tokenId)
        ).liquidity;
        const lowerPrice = await pangea.tickMath.getSqrtRatioAtTick(lower);
        const currentPrice = (await pool.getPriceAndNearestTicks())._price;
        const maxDx = await getDx(
          await pool.liquidity(),
          lowerPrice,
          currentPrice,
          false
        );

        // swap back and forth
        const swapTx = await swapViaRouter({
          pool: pool,
          zeroForOne: true,
          inAmount: maxDx,
          recipient: defaultAddress,
        });

        const ts = (
          await pangea.concentratedPoolManager.totalSupply()
        ).toNumber();
        addLiquidityParams = {
          pool: pool,
          amount0Desired: getBigNumber(1000),
          amount1Desired: getBigNumber(1000),
          lowerOld: helper.insert(lower),
          lower,
          upperOld: helper.insert(upper),
          upper,
          positionOwner: pangea.concentratedPoolManager.address,
          recipient: defaultAddress,
          positionId: ts,
        };

        await expect(
          addLiquidityViaManager(addLiquidityParams)
        ).to.be.revertedWith("PoolMisMatch");
      }
    });

    it("Should fail to burn if overflow", async () => {
      const pool = pangea.concentratedPools[0];

      helper.reset();
      const tickSpacing = (await pool.getImmutables())._tickSpacing;
      const tickAtPrice = await getTickAtCurrentPrice(pool);
      const nearestValidTick = tickAtPrice - (tickAtPrice % tickSpacing);
      const nearestEvenValidTick =
        (nearestValidTick / tickSpacing) % 2 == 0
          ? nearestValidTick
          : nearestValidTick + tickSpacing;

      let lower = nearestEvenValidTick - step;
      let upper = nearestEvenValidTick + step + tickSpacing;

      let addLiquidityParams = {
        pool: pool,
        amount0Desired: getBigNumber(1000),
        amount1Desired: getBigNumber(1000),
        lowerOld: helper.insert(lower),
        lower,
        upperOld: helper.insert(upper),
        upper,
        positionOwner: pangea.concentratedPoolManager.address,
        recipient: defaultAddress,
      };

      await addLiquidityViaManager(addLiquidityParams);

      lower = 609332;
      upper = lower + 1;

      await expect(
        pool
          .connect(pangea.accounts[4])
          .burn(lower, upper, BigNumber.from(`2`).pow(128).sub(`1`))
      ).to.be.revertedWith("Overflow");
    });
  });
});
