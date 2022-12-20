import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { waitConfirmations } from "./utils";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  network,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const { deployer, dev } = await getNamedAccounts();

  let stone = "";
  let distributor = "";
  let targetPools: string[] = [];
  if (network.name == "baobab") {
    stone = "0x816BE2E0594D7cFF6a745591E72BB7397F272385";
    distributor = "0x9DbFf83B52E584DeBF5593B6b8B9C6aa3bEEb116";
    targetPools = [
      "0xc322b656c8A56b64a03004c2E0BC4fcEEB23C06f",
      "0x23303Def910469dddbf9C5e2D11920418eB82edf",
      "0xB1E6dD3624867fE60E6D638f1A7B857bDCC928E0",
    ];
  } else if (network.name == "cypress") {
    stone = "0xB49E754228bc716129E63b1a7b0b6cf27299979e";
    distributor = "0x6dB1c7A3c18d6649F7654BbdD4F10D4BFb255752";
    targetPools = [
      // KLAY / oUSDT
      "0xAAbec6D08c4a5aB33a4D8DC697Dce65a61B5c344",
      // oETH / oUSDT
      "0xEace3F7Ff9e48E006380a135867dB3081E3B1842",
      // oUSDC / oUSDT
      "0x9A2339E89d7030630edb99B73228BB9bB68fa450",
      // KDAI / oUSDT
      "0x8a9ab142C9caE18594EA1c83374ec7c70dFB65E9",
    ];
  } else {
    return;
  }

  await deploy("StoneScheduler", {
    from: deployer,
    proxy: {
      owner: dev,
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [distributor, stone, targetPools],
        },
      },
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
  });
};

export default deployFunction;

deployFunction.tags = ["StoneScheduler", "deploy"];
