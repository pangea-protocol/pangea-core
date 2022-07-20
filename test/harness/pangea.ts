import { BigNumber } from "@ethersproject/bignumber";
import { ContractFactory } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { utils } from "ethers";
import { ethers } from "hardhat";
import {
  ConcentratedLiquidityPool,
  ConcentratedLiquidityPoolFactory,
  ConcentratedLiquidityPoolHelper,
  ConcentratedLiquidityPoolManager,
  PoolLogger,
  MasterDeployer,
  TickMathMock,
  ERC20Mock,
  PoolRouter,
  WETH10,
  SwapHelper,
  AirdropDistributor,
  PoolDashboard,
} from "../../types";
import { getBigNumber, getFactories, sortTokens } from "./helpers";

export const TWO_POW_96 = BigNumber.from(2).pow(96);

export class Pangea {
  private static _instance: Pangea;

  private tokenSupply = getBigNumber(10000000);

  public accounts!: SignerWithAddress[];
  public tokens!: ERC20Mock[];
  public weth!: WETH10;
  public extraToken!: ERC20Mock;
  public tokenMap: [{ string: ERC20Mock }] = {} as [{ string: ERC20Mock }];
  public masterDeployer!: MasterDeployer;
  public poolLogger!: PoolLogger;
  public poolDashboard!: PoolDashboard;
  public router!: PoolRouter;
  public concentratedPoolManager!: ConcentratedLiquidityPoolManager;
  public concentratedPoolFactory!: ConcentratedLiquidityPoolFactory;
  public concentratedPoolHelper!: ConcentratedLiquidityPoolHelper;
  public concentratedPools!: ConcentratedLiquidityPool[];
  public tickMath!: TickMathMock;
  public swapHelper!: SwapHelper;
  public airdropDistributor!: AirdropDistributor;

  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  public async init() {
    this.accounts = await ethers.getSigners();

    const [
      ERC20,
      WETH10,
      Deployer,
      PoolRouter,
      ConcentratedPoolHelper,
      PoolDashboard,
      AirdropDistributor,
      TickMath,
      TickIndex,
      TickLibrary,
      SwapHelper,
    ] = await Promise.all(
      getFactories([
        "ERC20Mock",
        "WETH10",
        "MasterDeployer",
        "PoolRouter",
        "ConcentratedLiquidityPoolHelper",
        "PoolDashboard",
        "AirdropDistributor",
        "TickMathMock",
        "TickIndex",
        "Ticks",
        "SwapHelper",
      ])
    );

    const tickLibrary = await TickLibrary.deploy();
    const tickIndexLibrary = await TickIndex.deploy();
    const clpLibs = {};
    clpLibs["Ticks"] = tickLibrary.address;

    const PoolFactoryLibrary = await ethers.getContractFactory(
      "PoolFactoryLib",
      {
        libraries: clpLibs,
      }
    );
    const PoolFactoryLib = (await PoolFactoryLibrary.deploy()).address;
    const ConcentratedPoolFactory = await ethers.getContractFactory(
      "ConcentratedLiquidityPoolFactory",
      { libraries: { PoolFactoryLib } }
    );
    const ConcentratedLiquidityPool = await ethers.getContractFactory(
      "ConcentratedLiquidityPool",
      {
        libraries: clpLibs,
      }
    );
    const ConcentratedPoolManager = await ethers.getContractFactory(
      "ConcentratedLiquidityPoolManager",
      {
        libraries: { TickIndex: tickIndexLibrary.address },
      }
    );
    const Logger = await ethers.getContractFactory("PoolLogger");

    await this.deployTokens(ERC20);
    await this.deployWETH(WETH10);
    await this.deploySwapHelper(SwapHelper);
    await this.deployPangeaPeriphery(Deployer, PoolRouter);
    await this.deployAirdropDistributor(AirdropDistributor);
    await this.deployPoolDashboard(PoolDashboard);
    await this.deployConcentratedPeriphery(
      Logger,
      ConcentratedPoolManager,
      ConcentratedPoolFactory,
      ConcentratedPoolHelper,
      TickMath
    );
    await this.addFactoriesToWhitelist();
    await this.deployConcentratedCore(ConcentratedLiquidityPool);

    return this;
  }

  public async getTokenBalance(tokens: string[], address: string) {
    const promises: Promise<BigNumber>[] = [];
    for (let token of tokens) {
      promises.push(this.tokenMap[token].balanceOf(address));
    }
    return Promise.all(promises);
  }

  private async deployConcentratedCore(CLP: ContractFactory) {
    const [token0, token1] = sortTokens(this.tokens);
    const concentratedPools: ConcentratedLiquidityPool[] = [];
    const prices: BigNumber[] = [];

    // stable price feed
    prices.push(TWO_POW_96);

    // low price feed
    prices.push(TWO_POW_96.div(16));

    // high price feed
    prices.push(TWO_POW_96.mul(16));

    const feeAndTicks = [
      [10_000, 100],
      [2_000, 20],
      [600, 6],
      [100, 1],
    ];

    function data(token0, token1, fee, price, tickSpacing) {
      return utils.defaultAbiCoder.encode(
        ["address", "address", "uint24", "uint160", "uint24", "address"],
        [token0, token1, fee, price, tickSpacing, ethers.constants.AddressZero]
      );
    }

    for (let j = 0; j < feeAndTicks.length; j++) {
      const [fee, tickSpacing] = feeAndTicks[j];
      await this.masterDeployer.deployPool(
        this.concentratedPoolFactory.address,
        data(
          token0.address,
          token1.address,
          fee,
          prices[j % prices.length],
          tickSpacing
        )
      );
    }

    const poolAddresses = await this.concentratedPoolFactory.getPools(
      token0.address,
      token1.address,
      0,
      feeAndTicks.length
    );

    for (let poolAddress of poolAddresses) {
      concentratedPools.push(
        (await CLP.attach(poolAddress)) as ConcentratedLiquidityPool
      );
    }

    this.concentratedPools = concentratedPools;
  }

  private async deployTokens(ERC20: ContractFactory) {
    this.tokens = await Promise.all([
      ERC20.deploy("TokenA", "TOK", this.tokenSupply),
      ERC20.deploy("TokenB", "TOK", this.tokenSupply),
    ] as Promise<ERC20Mock>[]);
    this.extraToken = (await ERC20.deploy(
      "TokenC",
      "TOK",
      this.tokenSupply
    )) as ERC20Mock;
    this.tokenMap[this.tokens[0].address] = this.tokens[0];
    this.tokenMap[this.tokens[1].address] = this.tokens[1];
    this.tokens = sortTokens(this.tokens);
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

  private async deployPoolDashboard(PoolDashboard: ContractFactory) {
    this.poolDashboard = (await PoolDashboard.deploy()) as PoolDashboard;
    await this.poolDashboard.initialize(
      this.masterDeployer.address,
      this.airdropDistributor.address
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
    ConcentratedPoolManager: ContractFactory,
    ConcentratedPoolFactory: ContractFactory,
    ConcentratedPoolHelper: ContractFactory,
    TickMath: ContractFactory
  ) {
    this.concentratedPoolManager =
      (await ConcentratedPoolManager.deploy()) as ConcentratedLiquidityPoolManager;
    await this.concentratedPoolManager.initialize(
      this.masterDeployer.address,
      this.weth.address
    );
    this.concentratedPoolFactory =
      (await ConcentratedPoolFactory.deploy()) as ConcentratedLiquidityPoolFactory;
    this.poolLogger = (await Logger.deploy()) as PoolLogger;
    await this.poolLogger.initialize(this.masterDeployer.address);
    await this.concentratedPoolFactory.initialize(
      this.masterDeployer.address,
      this.poolLogger.address
    );

    // for testing
    this.concentratedPoolHelper =
      (await ConcentratedPoolHelper.deploy()) as ConcentratedLiquidityPoolHelper;
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
