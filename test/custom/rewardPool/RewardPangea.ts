import { BigNumber } from "@ethersproject/bignumber";
import { ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ethers } from "hardhat";
import {
  PoolLogger,
  MasterDeployer,
  TickMathMock,
  ERC20Mock,
  PoolRouter,
  WETH10,
  SwapHelper,
  AirdropDistributor,
  RewardLiquidityPoolManager,
  RewardLiquidityPoolFactory,
} from "../../../types";
import { getFactories } from "../../harness/helpers";

export const TWO_POW_96 = BigNumber.from(2).pow(96);

export class RewardPangea {
  private static _instance: RewardPangea;

  public accounts!: SignerWithAddress[];
  public tokens!: ERC20Mock[];
  public weth!: WETH10;
  public extraToken!: ERC20Mock;
  public masterDeployer!: MasterDeployer;
  public poolLogger!: PoolLogger;
  public router!: PoolRouter;
  public concentratedPoolManager!: RewardLiquidityPoolManager;
  public concentratedPoolFactory!: RewardLiquidityPoolFactory;
  public tickMath!: TickMathMock;
  public swapHelper!: SwapHelper;
  public airdropDistributor!: AirdropDistributor;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    this.accounts = await ethers.getSigners();

    const [
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
    const tickLibrary = await RewardTicks.deploy();
    const tickIndexLibrary = await TickIndex.deploy();
    const clpLibs = {};
    clpLibs["RewardTicks"] = tickLibrary.address;

    const RewardPoolFactoryLibrary = await ethers.getContractFactory(
      "RewardLiquidityPoolFactoryLib",
      {
        libraries: clpLibs,
      }
    );
    const RewardLiquidityPoolFactoryLib = (
      await RewardPoolFactoryLibrary.deploy()
    ).address;
    const RewardLiquidityPoolFactory = await ethers.getContractFactory(
      "RewardLiquidityPoolFactory",
      { libraries: { RewardLiquidityPoolFactoryLib } }
    );
    const ConcentratedPoolManager = await ethers.getContractFactory(
      "RewardLiquidityPoolManager",
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
      Logger,
      ConcentratedPoolManager,
      RewardLiquidityPoolFactory,
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
    Logger: ContractFactory,
    poolManager: ContractFactory,
    ConcentratedPoolFactory: ContractFactory,
    TickMath: ContractFactory
  ) {
    this.concentratedPoolManager =
      (await poolManager.deploy()) as RewardLiquidityPoolManager;
    await this.concentratedPoolManager.initialize(
      this.masterDeployer.address,
      this.weth.address
    );
    this.concentratedPoolFactory =
      (await ConcentratedPoolFactory.deploy()) as RewardLiquidityPoolFactory;
    this.poolLogger = (await Logger.deploy()) as PoolLogger;
    await this.poolLogger.initialize(this.masterDeployer.address);
    await this.concentratedPoolFactory.initialize(
      this.masterDeployer.address,
      this.poolLogger.address
    );
    this.tickMath = (await TickMath.deploy()) as TickMathMock;
  }

  private async addFactoriesToWhitelist() {
    await Promise.all([
      this.masterDeployer.addToWhitelistFactory(
        this.concentratedPoolFactory.address
      ),
    ]);
  }
}
