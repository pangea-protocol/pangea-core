# PANGEA-Protocol : Next Generation Exchange with Concentrated Liquidity Pool

This repository contains the core smart contracts(Concentrated Liquidity Pool) for the PANGEA Protocol. In-depth documentation on Pangea is available at [pangea docs](https://pangea.gitbook.io/pangea-kr/overview/undefined).

### Addresses

#### Baobab

* service : [baobab pangea](https://app.dev.pangeaswap.com/)

| contract | address |
| ---      | ----    |
| AirdropDistributor | `0xabAF9FED5d9Fc75C379f5811de61Ed944b537375` | 
| ConcentratedLiquidityPoolFactory | `0x2be2C91cCA2df52b41a9e42723c46fD029359c95` | 
| ConcentratedLiquidityPoolHelper | `0x1de8bA72924a257E638c9EAb5254Cd3D7D1972a2` | 
| ConcentratedLiquidityPoolManager | `0xA1C559400fb27673023224A609843b60e674855F` | 
| MasterDeployer | `0x899d8Ff3d3BD16DBE4eFF245BdA27EF96C01044B` |
| PoolLogger | `0x6e66D3aDfc2902b9e0A46C80D2803642596cc5F6` | 
| PoolRouter | `0x42271971dbF42fbfEaF7F428604a86760300cB5B` |  
| SwapHelper | `0xe45fDcd3e7f7bbd597fECA1aC45C879e6a04F197` | 
| WETH10 | `0x0339d5Eb6D195Ba90B13ed1BCeAa97EbD198b106` | 


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
