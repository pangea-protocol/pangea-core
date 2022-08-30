import {ethers, network} from "hardhat";
import {
  ERC20Test,
  MasterDeployer,
  MockRewardLiquidityPool,
  PoolRouter,
  RewardLiquidityPoolFactory,
  RewardLiquidityPoolManager,
} from "../../../types";
import {BigNumber} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {sortTokens} from "../../harness/utils";
import {RewardPangea} from "./RewardPangea";
import {expect} from "chai";

describe("Reward Liquidity Pool UNIT TEST : FACTORY", function () {
  const TWO_POW_96 = BigNumber.from(2).pow(96);
  const SWAP_FEE = 0;
  const TICK_SPACING = 40;
  const DAY = 3600 * 24;
  const WEEK = DAY * 7;
  const DUST_VALUE_LIMIT = 10;

  let _snapshotId: string;
  let snapshotId: string;

  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let airdrop: SignerWithAddress;

  let pangea: RewardPangea;
  let masterDeployer: MasterDeployer;
  let poolFactory: RewardLiquidityPoolFactory;
  let poolManager: RewardLiquidityPoolManager;
  let pool: MockRewardLiquidityPool;
  let router: PoolRouter;
  let token0: ERC20Test;
  let token1: ERC20Test;
  let rewardToken: ERC20Test;

  before(async () => {
    _snapshotId = await ethers.provider.send("evm_snapshot", []);

    // ======== SIGNER ==========
    [deployer, liquidityProvider, trader, airdrop] = await ethers.getSigners();

    // ======== CONTRACT ==========
    pangea = await RewardPangea.Instance.init();
    masterDeployer = pangea.masterDeployer;
    poolFactory = pangea.poolFactory;
    poolManager = pangea.poolManager;
    router = pangea.router;

    // ======== TOKENS ==========
    const Token = await ethers.getContractFactory("ERC20Test");
    token0 = (await Token.deploy("tokenA", "A", 18)) as ERC20Test;
    token1 = (await Token.deploy("tokenB", "B", 18)) as ERC20Test;
    [token0, token1] = sortTokens(token0, token1);

    rewardToken = (await Token.deploy("REWARD", "R", 18)) as ERC20Test;

    // ======== DEPLOY POOL ========
    await poolFactory.setAvailableParameter(
        token0.address,
        token1.address,
        rewardToken.address,
        BigNumber.from(SWAP_FEE),
        BigNumber.from(TICK_SPACING)
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
              BigNumber.from(TICK_SPACING),
            ]
        )
    );
    await masterDeployer.setAirdropDistributor(airdrop.address);

    const poolAddress = (
        await poolFactory.getPools(token0.address, token1.address, 0, 1)
    )[0];
    pool = await ethers.getContractAt<MockRewardLiquidityPool>(
        "MockRewardLiquidityPool",
        poolAddress
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

  describe("# upgrade Pool", async () => {
    let mockPoolAddress: string;

    beforeEach("create position", async () => {
      const tickLibrary = await ethers.getContractFactory("RewardTicks");
      const clpLibs = {};
      clpLibs["RewardTicks"] = (await tickLibrary.deploy()).address;
      const MockRewardLiquidityPool = await ethers.getContractFactory(
          "MockRewardLiquidityPool",
          {
            libraries: clpLibs,
          }
      );
      mockPoolAddress = (await MockRewardLiquidityPool.deploy()).address;
    });

    it("try to upgrade pool Spec", async () => {
      // upgrade
      await poolFactory.setPoolImplementation(mockPoolAddress);

      // before fail
      await expect(pool.greet()).to.be.reverted

      // if upgrade pools,
      await poolFactory.upgradePools([pool.address]);

      // then success
      expect(await pool.greet()).to.be.eq('hello');
    });
  });
});
