import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { doTransaction, waitConfirmations } from "../utils";
import { YieldPoolFactory__factory } from "../../types";
import { BigNumber } from "ethers";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { dev } = await getNamedAccounts();
  const deployer = await ethers.getNamedSigner("deployer");
  const yieldToken = "0x675433Ac642EA193A260D82777C2eC22e22482c2";

  // [1] Upgrade YieldPoolV2
  const { address: poolImplementation } = await deploy("YieldPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks: "0xfF8E5bDf54D5ab74D2E56CA0E575348A52B95B3d",
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });

  // [2] Upgrade YieldPoolFactory
  const { address: YieldPoolFactoryAddress } = await deploy(
    "YieldPoolFactory",
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
              yieldToken,
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
  const yieldPoolFactory = YieldPoolFactory__factory.connect(
    YieldPoolFactoryAddress,
    deployer
  );

  // [4] set Pool Implementation
  await doTransaction(
    yieldPoolFactory.setPoolImplementation(poolImplementation)
  );

  // [5] upgrade previous pools
  const pools = [
    "0x71dCc419dD82264D0530B6e80f6D66032aE49097",
    "0x0Fff60B1178e302d8b223517CA8e3a9C20b4716A",
    "0x178Cb23277De6d2188089763dE40127A5744483f",
    "0xae89f3D989c1bFc261e89fD74c1Db957f7F23057",
  ];

  await doTransaction(yieldPoolFactory.upgradePools(pools));
};

export default deployFunction;

deployFunction.tags = ["baobab-YieldPool-Upgrade"];
