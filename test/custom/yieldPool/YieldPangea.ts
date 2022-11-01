import { BigNumber } from "@ethersproject/bignumber";
import { ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";
import {
  AirdropDistributor,
  ERC20Mock,
  MasterDeployer,
  YieldPool,
  YieldPoolFactory,
  MiningPoolManager,
  PoolLogger,
  PoolRouter,
  SwapHelper,
  TickMathMock,
  WETH10,
  MockYToken,
} from "../../../types";
import { getFactories } from "../../harness/helpers";

export const TWO_POW_96 = BigNumber.from(2).pow(96);

export class YieldPangea {
  private static _instance: YieldPangea;

  public accounts!: SignerWithAddress[];
  public tokens!: ERC20Mock[];
  public yToken!: MockYToken;
  public weth!: WETH10;
  public extraToken!: ERC20Mock;
  public masterDeployer!: MasterDeployer;
  public poolLogger!: PoolLogger;
  public router!: PoolRouter;
  public poolManager!: MiningPoolManager;
  public poolFactory!: YieldPoolFactory;
  public tickMath!: TickMathMock;
  public swapHelper!: SwapHelper;
  public airdropDistributor!: AirdropDistributor;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    this.accounts = await ethers.getSigners();

    const [
      YToken,
      WETH10,
      Deployer,
      PoolRouter,
      AirdropDistributor,
      TickMath,
      TickIndex,
      RewardTicks,
      SwapHelper,
    ] = await Promise.all(
      getFactories([
        "MockYToken",
        "WETH10",
        "MasterDeployer",
        "PoolRouter",
        "AirdropDistributor",
        "TickMathMock",
        "TickIndex",
        "RewardTicks",
        "SwapHelper",
      ])
    );
    this.yToken = (await YToken.deploy()) as MockYToken;

    const tickLibrary = await RewardTicks.deploy();
    const tickIndexLibrary = await TickIndex.deploy();
    const clpLibs = {};
    clpLibs["RewardTicks"] = tickLibrary.address;
    const YieldPool = await ethers.getContractFactory("YieldPoolV2", {
      libraries: clpLibs,
    });

    const YieldPoolFactory = await ethers.getContractFactory(
      "YieldPoolFactory"
    );
    const MiningPoolManager = await ethers.getContractFactory(
      "MiningPoolManager",
      {
        libraries: { TickIndex: tickIndexLibrary.address },
      }
    );
    const Logger = await ethers.getContractFactory("PoolLogger");
    await this.deployWETH(WETH10);
    await this.deploySwapHelper(SwapHelper);
    await this.deployPangeaPeriphery(Deployer, PoolRouter);
    await this.deployAirdropDistributor(AirdropDistributor);
    await this.deployConcentratedPeriphery(
      YieldPool,
      Logger,
      MiningPoolManager,
      YieldPoolFactory,
      TickMath
    );
    await this.addFactoriesToWhitelist();

    return this;
  }

  private async deployWETH(WETHFactory: ContractFactory) {
    this.weth = (await WETHFactory.deploy()) as WETH10;
  }

  private async deploySwapHelper(SwapHelper: ContractFactory) {
    this.swapHelper = (await SwapHelper.deploy(
      this.weth.address
    )) as SwapHelper;
  }

  private async deployAirdropDistributor(AirdropDistributor: ContractFactory) {
    this.airdropDistributor =
      (await AirdropDistributor.deploy()) as AirdropDistributor;
    await this.airdropDistributor.initialize(
      this.masterDeployer.address,
      this.weth.address
    );
  }

  private async deployPangeaPeriphery(
    Deployer: ContractFactory,
    PoolRouter: ContractFactory
  ) {
    const barFeeTo = this.accounts[1].address;
    this.masterDeployer = (await Deployer.deploy()) as MasterDeployer;
    await this.masterDeployer.initialize(barFeeTo);
    this.router = (await PoolRouter.deploy()) as PoolRouter;
    await this.router.initialize(
      this.masterDeployer.address,
      this.weth.address
    );
  }

  private async deployConcentratedPeriphery(
    YieldPool: ContractFactory,
    Logger: ContractFactory,
    poolManager: ContractFactory,
    PoolFactory: ContractFactory,
    TickMath: ContractFactory
  ) {
    this.poolManager = (await poolManager.deploy()) as MiningPoolManager;
    await this.poolManager.initialize(
      this.masterDeployer.address,
      this.weth.address
    );
    this.poolFactory = (await PoolFactory.deploy()) as YieldPoolFactory;
    this.poolLogger = (await Logger.deploy()) as PoolLogger;
    await this.poolLogger.initialize(this.masterDeployer.address);
    const pool = (await YieldPool.deploy()) as YieldPool;
    await this.poolFactory.initialize(
      pool.address,
      this.masterDeployer.address,
      this.poolLogger.address,
      this.yToken.address
    );
    this.tickMath = (await TickMath.deploy()) as TickMathMock;
  }

  private async addFactoriesToWhitelist() {
    await Promise.all([
      this.masterDeployer.addToWhitelistFactory(this.poolFactory.address),
    ]);
  }
}
