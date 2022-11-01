import { BigNumber } from "@ethersproject/bignumber";
import { ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";
import {
  ERC20Mock,
  MasterDeployer,
  MiningPool,
  MiningPoolFactory,
  MiningPoolManager,
  PoolLogger,
  PoolRouter,
  SwapHelper,
  TickMathMock,
  WETH10,
} from "../../../types";
import { getFactories } from "../../harness/helpers";

export const TWO_POW_96 = BigNumber.from(2).pow(96);

export class MiningPangea {
  private static _instance: MiningPangea;

  public accounts!: SignerWithAddress[];
  public tokens!: ERC20Mock[];
  public weth!: WETH10;
  public extraToken!: ERC20Mock;
  public masterDeployer!: MasterDeployer;
  public poolLogger!: PoolLogger;
  public router!: PoolRouter;
  public poolManager!: MiningPoolManager;
  public poolFactory!: MiningPoolFactory;
  public tickMath!: TickMathMock;
  public swapHelper!: SwapHelper;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    this.accounts = await ethers.getSigners();

    const [
      WETH10,
      Deployer,
      PoolRouter,
      TickMath,
      TickIndex,
      RewardTicks,
      SwapHelper,
    ] = await Promise.all(
      getFactories([
        "WETH10",
        "MasterDeployer",
        "PoolRouter",
        "TickMathMock",
        "TickIndex",
        "RewardTicks",
        "SwapHelper",
      ])
    );
    const tickLibrary = await RewardTicks.deploy();
    const tickIndexLibrary = await TickIndex.deploy();
    const clpLibs = {};
    clpLibs["RewardTicks"] = tickLibrary.address;
    const MiningPool = await ethers.getContractFactory("MiningPoolV2", {
      libraries: clpLibs,
    });

    const MiningPoolFactory = await ethers.getContractFactory(
      "MiningPoolFactory"
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
    await this.deployConcentratedPeriphery(
      MiningPool,
      Logger,
      MiningPoolManager,
      MiningPoolFactory,
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
    MiningPool: ContractFactory,
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
    this.poolFactory = (await PoolFactory.deploy()) as MiningPoolFactory;
    this.poolLogger = (await Logger.deploy()) as PoolLogger;
    await this.poolLogger.initialize(this.masterDeployer.address);
    const pool = (await MiningPool.deploy()) as MiningPool;
    await this.poolFactory.initialize(
      pool.address,
      this.masterDeployer.address,
      this.poolLogger.address
    );
    this.tickMath = (await TickMath.deploy()) as TickMathMock;
  }

  private async addFactoriesToWhitelist() {
    await Promise.all([
      this.masterDeployer.addToWhitelistFactory(this.poolFactory.address),
    ]);
  }
}
