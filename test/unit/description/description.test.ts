import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolManager,
  ERC20Test,
  PositionDescription,
} from "../../../types";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { describe } from "mocha";
import { BigNumber } from "ethers";

/**
 * description unit
 */
describe("unit test : description", function () {
  let _snapshotId: string;
  let snapshotId: string;

  let poolManager: FakeContract<ConcentratedLiquidityPoolManager>;
  let pool: FakeContract<ConcentratedLiquidityPool>;
  let token0: FakeContract<ERC20Test>;
  let token1: FakeContract<ERC20Test>;

  let positionDescription: PositionDescription;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== CONTRACT ==========
    poolManager = await smock.fake<ConcentratedLiquidityPoolManager>(
      "ConcentratedLiquidityPoolManager"
    );
    pool = await smock.fake<ConcentratedLiquidityPool>(
      "ConcentratedLiquidityPool"
    );
    token0 = await smock.fake<ERC20Test>("ERC20Test");
    token1 = await smock.fake<ERC20Test>("ERC20Test");

    poolManager.positions.returns([
      pool.address,
      BigNumber.from(10).pow(10),
      -120,
      100,
      0,
      0,
      0,
      0,
      0,
    ]);

    pool.token0.returns(token0.address);
    pool.token1.returns(token1.address);
    pool.swapFee.returns(1000);
    pool.price.returns(BigNumber.from(2).pow(96));
    token0.symbol.returns("TOKEN_A");
    token1.symbol.returns("TOKEN_B");
    token0.decimals.returns(18);
    token1.decimals.returns(18);

    const biArrow = await (await ethers.getContractFactory("BiArrow")).deploy();
    const font = await (await ethers.getContractFactory("Font")).deploy();
    const message = await (await ethers.getContractFactory("Message")).deploy();
    const offPosition = await (
      await ethers.getContractFactory("OffPosition")
    ).deploy();
    const onPosition = await (
      await ethers.getContractFactory("OnPosition")
    ).deploy();

    const PositionDescription = await ethers.getContractFactory(
      "PositionDescription",
      {
        libraries: {
          BiArrow: biArrow.address,
          Font: font.address,
          Message: message.address,
          OffPosition: offPosition.address,
          OnPosition: onPosition.address,
        },
      }
    );
    positionDescription =
      (await PositionDescription.deploy()) as PositionDescription;
    await positionDescription.initialize(poolManager.address);

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

  describe("TOKEN_URI GENERATION", async () => {
    it("rendering OnPosition Image", async () => {
      console.log(await positionDescription.tokenURI(1));
    });

    it("rendering OffPosition Image", async () => {
      poolManager.positions.returns([
        pool.address,
        BigNumber.from(10).pow(10),
        80,
        100,
        0,
        0,
        0,
        0,
        0,
      ]);

      console.log(await positionDescription.tokenURI(1));
    });
  });
});
