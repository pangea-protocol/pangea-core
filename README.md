# PANGEA-Protocol : Next Generation Exchange with Concentrated Liquidity Pool

This repository contains the core smart contracts(Concentrated Liquidity Pool) for the PANGEA Protocol. In-depth documentation on Pangea is available at [pangea docs](https://pangea.gitbook.io/pangea-kr/overview/undefined).

### Addresses

#### Baobab

* service : [baobab pangea](https://app.dev.pangeaswap.com/)

| contract | address                                       |
| ---      |-----------------------------------------------|
| AirdropDistributor | `0xabAF9FED5d9Fc75C379f5811de61Ed944b537375`  | 
| ConcentratedLiquidityPoolFactory | `0x2be2C91cCA2df52b41a9e42723c46fD029359c95`  | 
| ConcentratedLiquidityPoolHelper | `0x1de8bA72924a257E638c9EAb5254Cd3D7D1972a2`  | 
| ConcentratedLiquidityPoolManager | `0xA1C559400fb27673023224A609843b60e674855F`  | 
| MasterDeployer | `0x899d8Ff3d3BD16DBE4eFF245BdA27EF96C01044B`  |
| PoolLogger | `0x6e66D3aDfc2902b9e0A46C80D2803642596cc5F6`  | 
| PoolRouter | `0x42271971dbF42fbfEaF7F428604a86760300cB5B`  |  
| PositionDashboard | `0xCF8D8433B749c06F5D84d133224dfeeb8Db58515`  |
| SwapHelper | `0xe45fDcd3e7f7bbd597fECA1aC45C879e6a04F197`  | 
| WETH10 | `0x0339d5Eb6D195Ba90B13ed1BCeAa97EbD198b106`  | 

#### Contracts

* service : [pangea](https://app.pangeaswap.com/)

| contract | address |
| ---      | ----    |
| AirdropDistributor | `0x5d5Cc76396742C6E4A7a21ff352e04957eae5304` | 
| ConcentratedLiquidityPoolFactory | `0x3d94b5E3b83CbD52B9616930D33515613ADfAd67` | 
| ConcentratedLiquidityPoolHelper | `0x514b7A31f51c4171C40c5b3a183d466db593a4b8` | 
| ConcentratedLiquidityPoolManager | `0xEd52BD01b0608a6B6d4f4E03aFfCe16c1FF19c23` | 
| MasterDeployer | `0xEB4B1CE03bb947Ce23ABd1403dF7C9B86004178d` |
| PoolLogger | `0x002A422533cccEeA9aBF9e56e2A25d72672891bC` | 
| PoolRouter | `0x17Ac28a29670e637c8a6E1ec32b38fC301303E34` |  
| PositionDashboard | `0x6e1832b4791E195939C10C2A00b5A9456E337dA2` |
| SwapHelper | `0xe80FE14d4c67598A2a8F107f1b95FECC2Bb08E7D` | 
| WETH10 | `0xFF3e7cf0C007f919807b32b30a4a9E7Bd7Bc4121` | 

### SetUp

#### Install Dependencies

````shell
yarn install
````

#### Compile Contracts

````shell
yarn build
````

#### Run Tests

````shell
yarn test
````

#### Run Test Coverage

````shell
yarn coverage
````

#### Run Local Test Network

````shell
yarn hardhat:deploy
````

#### AUDITS

* [HACHI LABS audit](https://github.com/pangea-protocol/pangea-core/blob/main/audits/%5BHAECHI%20AUDIT%5D%20Smart%20Contract%20Audit%20Reports%20for%20Pangea.pdf)
