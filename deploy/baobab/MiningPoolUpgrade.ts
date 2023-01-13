import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { doTransaction, waitConfirmations } from "../utils";
import { MiningPoolFactory__factory } from "../../types";
import { BigNumber } from "ethers";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { dev } = await getNamedAccounts();
  const deployer = await ethers.getNamedSigner("deployer");

  // [1] Upgrade MiningPoolV2
  const { address: poolImplementation } = await deploy("MiningPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks: "0xfF8E5bDf54D5ab74D2E56CA0E575348A52B95B3d",
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });

  // [2] Upgrade MiningPoolFactory
  const { address: MiningPoolFactoryAddress } = await deploy(
    "MiningPoolFactory",
    {
      from: deployer.address,
      proxy: {
        owner: dev,
        proxyContract: "OpenZeppelinTransparentProxy",
        execute: {
          init: {
            methodName: "initialize",
            args: [
              poolImplementation,
              "0x899d8Ff3d3BD16DBE4eFF245BdA27EF96C01044B",
              "0x6e66D3aDfc2902b9e0A46C80D2803642596cc5F6",
            ],
          },
        },
      },
      log: true,
      waitConfirmations: await waitConfirmations(),
      gasPrice: BigNumber.from("250000000000"),
    }
  );

  // [3] check protocolFee
  const miningPoolFactory = MiningPoolFactory__factory.connect(
    MiningPoolFactoryAddress,
    deployer
  );

  await doTransaction(
    miningPoolFactory.setPoolImplementation(poolImplementation)
  );

  await doTransaction(
    miningPoolFactory.setAvailableFeeAndTickSpacing(10_000, 100, true)
  );
  await doTransaction(
    miningPoolFactory.setAvailableFeeAndTickSpacing(2000, 20, true)
  );
  await doTransaction(
    miningPoolFactory.setAvailableFeeAndTickSpacing(600, 2, true)
  );
  await doTransaction(
    miningPoolFactory.setAvailableFeeAndTickSpacing(100, 2, true)
  );

  // [5] upgrade previous pools
  const pools = [
    "0xc322b656c8A56b64a03004c2E0BC4fcEEB23C06f",
    "0x23303Def910469dddbf9C5e2D11920418eB82edf",
    "0xB1E6dD3624867fE60E6D638f1A7B857bDCC928E0",
    "0x73997Da14B7f962474Bc934F8056D401C7391d56",
    "0xe8Ad8A95349B22ec6F72Ab79C6efEb8602c492BB",
    "0x3cF6d6825Bea2dA9C8B83a6756c8D7a694930857",
    "0xA35504725c5559fE159c39a6203378e8418c90c4",
    "0x6fd93c41F3348Ec82ddFD8f29531DfA558a85Ffd",
    "0x2bdB1E9e1fb002C2057912729A6Ac986884b511C",
    "0xf2dc775cE9Bd8124b68dc6d89227a11D64C9dc88",
  ];

  await doTransaction(miningPoolFactory.upgradePools(pools));
};

export default deployFunction;

deployFunction.tags = ["baobab-MiningPool-Upgrade"];
