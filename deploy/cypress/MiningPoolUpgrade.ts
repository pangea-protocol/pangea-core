import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { doTransaction, waitConfirmations } from "../utils";
import { MiningPoolFactory } from "../../types";
import { BigNumber } from "ethers";

const deployFunction: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  ethers,
}: HardhatRuntimeEnvironment) {
  const { deploy } = deployments;
  const deployer = await ethers.getNamedSigner("deployer");

  const { address: RewardTicks } = await deploy("RewardTicks", {
    from: deployer.address,
    deterministicDeployment: false,
    waitConfirmations: await waitConfirmations(),
    log: true,
    gasPrice: BigNumber.from("250000000000"),
  });

  // [1] Upgrade MiningPoolV2
  const { address: poolImplementation } = await deploy("MiningPoolV2", {
    from: deployer.address,
    libraries: {
      RewardTicks,
    },
    log: true,
    waitConfirmations: await waitConfirmations(),
    gasPrice: BigNumber.from("250000000000"),
  });

  const miningPoolFactory = (await ethers.getContract(
    "MiningPoolFactory",
    deployer
  )) as MiningPoolFactory;

  // [2] set Pool Implementation
  await doTransaction(
    miningPoolFactory.setPoolImplementation(poolImplementation)
  );

  // // [3] upgrade previous pools
  const pools = [
    "0x5CE5285Ab8261cb671a4217Ff48A89059497F858",
    "0x827eAb5e1d10F4E7A88bAd8aB419b3b8206d571F",
    "0x0E9B8c0289006e6f0D7f3c0Ec43f73CA78bBb617",
    "0x7FD37D56307d9020aFCBdE46b4933e942481eE61",
    "0x891dDF81e6F59315a2ba630570a546d5c5c29583",
    "0x5B408b436CFE343022f50d1736a9EE1D2794B04d",
    "0x382c407d975694F9E2F35f4EC81ce51FeD3cE5BE",
    "0x8B55c469e65689E541628dd7025B8c2F92e2ad09",
    "0x8034eE9b9dD1376d2E9Ea93bf136Fd0532743A6D",
    "0x8a9ab142C9caE18594EA1c83374ec7c70dFB65E9",
    "0x9A2339E89d7030630edb99B73228BB9bB68fa450",
    "0xAAbec6D08c4a5aB33a4D8DC697Dce65a61B5c344",
    "0xC313df55E69C76F69A08A7822C1c347b02e38617",
    "0xEace3F7Ff9e48E006380a135867dB3081E3B1842",
    "0xA14EB7EC25faA2949FA5D36ca42250a042c62889",
    "0x644D38A5D0d31889ac58525317A03e0d958a49c5",
    "0x98bD1e889F9F3d83b67C18Eb0Fca47de348F2f24",
    "0x6070B2E2B41272c7BDf0c219187bA5d0C9e3e5dF",
    "0xD01fB8bE80c754F0F5D98C45B11d22D5b00Ca66f",
    "0x59f8E0D5a51b712cFbf6fe1fA590d77357e782d6",
    "0xB7D7F20Ea2Ac460eD02e9D4ff8A5175F9e911C39",
    "0x249e2338Bce69e2df147Edc923694BB9Ee8cF045",
    "0x434D3C7062188E45c2530440542bb17Aa5C412BF",
    "0x4A60d68AB8928aB30D3244cf35fA40c0Ed614397",
    "0x4D2b0b87cD44397A1Dd92462Fc0f5D2ecad0937B",
    "0x0aB4b9C706Fb6bD0fD73817BD85035A471651988",
    "0x2A66d4ba3B105F3B506761ACFAC13bCa30fAbBc1",
    "0x0aACc14beb0f91825Dc94E9F6c4d0035d84C3Ae3",
    "0x2041D8e1275E8369E976C121948608A104CcA72F",
    "0xAB2530d710fA7e90FA4B7Ea4b022d021f7Fe5b24",
    "0xD1Cf5851742FF54CC6A414e89eA1C4f3807B0490",
    "0xa2a68FEb723F9DA144624828cF32d99a0289764C",
    "0x9c7dbA06f008e07cd8018C31611430b23A839FAD",
    "0x1F3669081b9e9AD57788bFcf897FCc0693E040C6",
    "0x83d1F9fe00e6F7613B76500677Ec742c824331aD",
    "0xb4548DB7214770624d7e2adD91c5E548Af71ed4A",
    "0x6C6b30F2A8f06eB0A5Ff1F0d441843eEe2139FbD",
    "0xb7F49B6a16A98CA92aAad4F2226B002DB0a8EbC2",
    "0x293d377C081e58856B23442ec76787d6CC1f3aA2",
    "0x8D355893BF798Cfa32C091a15dE9Bb88ea6aFC2e",
    "0xB67b6c71e09c94059bf5C9e74DeE49380b9eAcF7",
    "0x19475ed9fB2F3c497fb8a7818f6c495A72C80eB3",
    "0xeC09DFC47a6aabBf1273B26459c61A1e468708Cf",
    "0x2D6B9f71eAc31ab13d6c52F492a1eB1e13dcF9Ed",
    "0xb93450c31365a959a8C3eecaDf41931CECf702DC",
    "0x69BE6Ea9664D47e587D9a39c3e115108778fdeB7",
    "0xC276B47Feb97C40E8CB4170C82cf1f58D25Cae55",
    "0x449837CcaB238A727BA735658948eF1cD8c4f586",
    "0xEF2dfE6Ea2C962987BB1891F8101D71294768bD0",
    "0x212787dB23D183a61B59070bEC6DaA76F4A807fb",
    "0x87D1b1014BCaAB88D5c19bd4EC7EEeBD0e4Eb64A",
    "0xdEE9ef3ff3343cd2a32d4DE3938A0c15dB3b4416",
    "0x6399fa05faf2A091cDF9FFBD07C5C56575Bf6b91",
    "0x0fb3E577074337139b725635414BC9B53bDBEcEE",
    "0x373d2e0DD767036e132E0a98D9B3Fa7Cb2f9CA10",
    "0x57a1aeE7560c9A176a1F69615f0A651dCd4D4729",
    "0x2dA6026AaA58CB5a5D47bA045dc248b0363004B9",
    "0x179c5C511a5E036B9F388098278040E8c5658a82",
    "0x8C49f3b211d51C59479103E7c8a8D8Cecf37e952",
    "0x2f542fdB09e4E55d5e5b3F132b7bddb254378B00",
    "0x664EC45D2f605903A6b483B5B19D94a6A935d6e8",
    "0x368ECADc666dA76bf9bA2eD77E8f5d2aA386b7d7",
    "0xd125f5c4a7c6c1bE13a99f72F5aF0498D711BeED",
    "0xaa95Bb956A22a8f92057B44304b9D88e26ba93d0",
    "0xA58CB1e9Cd0c9827074879A7b2911f2CAd28270E",
    "0x8A35a0694f0632E55CCBe0c8069a6Abca6ba9bC0",
    "0x8CD35B9BBE09255Cf42fF0104d3715499f14f928",
    "0x078ca3267Ebe1dAD00078dd860866b60744c3754",
    "0x22efD1c7404061979627Dd85941a9CD4782a7D6A",
    "0x1Bc9A06dde59789713996BAC5712Cf78312F4A43",
    "0x5598A52Efee45db40cF1Eec86405A5D2848653ca",
    "0xDd0d0a90cEc9Bf032F48791a0e8159a0B94Eb694",
    "0xB86910241E952c2C78dA179F10068c0771d59079",
    "0xf2Dff8714da2ef029326c569aB2cFE28eCFc2314",
  ];
  //
  await doTransaction(miningPoolFactory.upgradePools(pools));
};

export default deployFunction;

deployFunction.tags = ["cypress-MiningPool-Upgrade"];
