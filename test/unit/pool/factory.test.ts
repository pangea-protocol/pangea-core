import { ethers, network } from "hardhat";
import {
  ConcentratedLiquidityPoolFactory,
  Ticks,
  PoolLogger,
  ERC20Test,
} from "../../../types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { describe } from "mocha";
import { BigNumber } from "ethers";

describe("SCENARIO:FACTORY", function () {
  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let masterDeployer: SignerWithAddress;

  let poolLogger: PoolLogger;
  let poolFactory: ConcentratedLiquidityPoolFactory;

  let token0: ERC20Test;
  let token1: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, masterDeployer] = await ethers.getSigners();

    const tickLibrary = await (
      await ethers.getContractFactory("Ticks")
    ).deploy();
    const poolFactoryLib = await (
      await ethers.getContractFactory("PoolFactoryLib", {
        libraries: {
          Ticks: tickLibrary.address,
        },
      })
    ).deploy();
    const clpLibs = {};
    clpLibs["PoolFactoryLib"] = poolFactoryLib.address;
    const Factory = await ethers.getContractFactory(
      "ConcentratedLiquidityPoolFactory",
      {
        libraries: clpLibs,
      }
    );
    const factory = await ethers.getContractFactory("ERC20Test");
    token0 = (await factory.deploy("TESTA", "A", 18)) as ERC20Test;
    token1 = (await factory.deploy("TESTB", "B", 18)) as ERC20Test;
    if (token0.address.toLowerCase() > token1.address.toLowerCase()) {
      [token0, token1] = [token1, token0];
    }

    poolLogger = (await (
      await ethers.getContractFactory("PoolLogger")
    ).deploy()) as PoolLogger;

    poolFactory = (await Factory.connect(
      deployer
    ).deploy()) as ConcentratedLiquidityPoolFactory;

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

  describe("# ACCESS CONTROL", async () => {
    it("revert case 1) deployer initialized address(0)", async () => {
      await expect(
        poolFactory.initialize(ethers.constants.AddressZero, poolLogger.address)
      ).to.be.reverted;
    });

    it("revert case 2) poolLogger initialized address(0)", async () => {
      await expect(
        poolFactory.initialize(
          masterDeployer.address,
          ethers.constants.AddressZero
        )
      ).to.be.reverted;
    });

    it("revert case 3) double initialization", async () => {
      await poolFactory.initialize(masterDeployer.address, poolLogger.address);
      await expect(
        poolFactory.initialize(masterDeployer.address, poolLogger.address)
      ).to.be.reverted;
    });

    it("revert case 4) initialize ZeroAddress", async () => {
      await expect(poolLogger.initialize(ethers.constants.AddressZero)).to.be
        .reverted;
    });
  });

  describe("# VIEW FUNCTION", async () => {
    beforeEach("initialize", async () => {
      await poolFactory.initialize(masterDeployer.address, poolLogger.address);
    });

    it("# getPoolAddress(uint256 idx)", async () => {
      // GIVEN
      await poolFactory.setAvailableFeeAndTickSpacing(1000, 20, true);
      const address = await poolFactory
        .connect(masterDeployer)
        .callStatic.deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              1000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );

      // WHEN
      await poolFactory
        .connect(masterDeployer)
        .deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              1000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );

      // THEN
      expect(await poolFactory.getPoolAddress(0)).to.be.eq(address);
    });

    it("# poolsCount(address token0, address token1)", async () => {
      // GIVEN
      await poolFactory.setAvailableFeeAndTickSpacing(1000, 20, true);
      await poolFactory
        .connect(masterDeployer)
        .deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              1000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );
      await poolFactory
        .connect(masterDeployer)
        .deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              2000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );

      // THEN
      expect(
        await poolFactory.poolsCount(token0.address, token1.address)
      ).to.be.eq(2);
      expect(
        await poolFactory.poolsCount(token1.address, token0.address)
      ).to.be.eq(2);
    });

    it("# totalPoolsCount()", async () => {
      // WHEN
      await poolFactory.setAvailableFeeAndTickSpacing(1000, 20, true);
      await poolFactory
        .connect(masterDeployer)
        .deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              1000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );
      await poolFactory.setAvailableFeeAndTickSpacing(2000, 20, true);
      await poolFactory
        .connect(masterDeployer)
        .deployPool(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "uint160", "uint24"],
            [
              token0.address,
              token1.address,
              2000,
              BigNumber.from(2).pow(96),
              20,
            ]
          )
        );

      // THEN
      expect(await poolFactory.totalPoolsCount()).to.be.eq(2);
    });
  });
});
