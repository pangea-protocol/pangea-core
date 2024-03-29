# PANGEA-Protocol : Next Generation Exchange with Concentrated Liquidity Pool

This repository contains the core smart contracts(Concentrated Liquidity Pool) for the PANGEA Protocol. In-depth documentation on Pangea is available at [pangea docs](https://pangea.gitbook.io/pangea-kr/overview/undefined).

### Addresses

#### Baobab

* service : [baobab pangea](https://app.dev.pangeaswap.com/)

| contract                                      | address                                       |
|-----------------------------------------------|-----------------------------------------------|
| AirdropDistributorV2                          | `0x9DbFf83B52E584DeBF5593B6b8B9C6aa3bEEb116` | 
| ConcentratedLiquidityPoolFactory              | `0x2be2C91cCA2df52b41a9e42723c46fD029359c95`  | 
| ConcentratedLiquidityPoolHelper               | `0x1f7d55F06A6FEb2bA06c614b49896547d16c2CA8`  | 
| ConcentratedLiquidityPoolManager              | `0xA1C559400fb27673023224A609843b60e674855F`  | 
| MasterDeployer                                | `0x899d8Ff3d3BD16DBE4eFF245BdA27EF96C01044B`  |
| PoolLogger                                    | `0x6e66D3aDfc2902b9e0A46C80D2803642596cc5F6`  | 
| PoolRouter                                    | `0x42271971dbF42fbfEaF7F428604a86760300cB5B`  |  
| PositionDashboard                             | `0xCF8D8433B749c06F5D84d133224dfeeb8Db58515`  |
| SwapHelper                                    | `0xe45fDcd3e7f7bbd597fECA1aC45C879e6a04F197`  | 
| WETH10                                        | `0x0339d5Eb6D195Ba90B13ed1BCeAa97EbD198b106`  |
| MiningPoolFactory (custom pool)               | `0x3e0c0b0737b57D5e7d6f6b10C0e945383bEba82c`  |
| YieldPoolFactory  (custom pool)               | `0x3135bB8273107BAe6297DF80fe0A8BD77a34C7E4`  |
| MiningPoolManager (for MiningPool & YieldPool) | `0xc6373f0e72A3eA9Fc405af928723c86c244E5e79`  |
| ClaimAggregator                               | `0x37754c81eB7632EDaC7104a51a8BE4223a41a628`  |


#### Contracts

* service : [pangea](https://app.pangeaswap.com/)

| contract                                        | address                                      |
|-------------------------------------------------|----------------------------------------------|
| AirdropDistributorV2                            | `0x6dB1c7A3c18d6649F7654BbdD4F10D4BFb255752` | 
| ConcentratedLiquidityPoolFactory                | `0x3d94b5E3b83CbD52B9616930D33515613ADfAd67` | 
| ConcentratedLiquidityPoolHelper                 | `0xA88955cd70C363a617465CbCf844d1dEa22177fe` | 
| ConcentratedLiquidityPoolManager                | `0xEd52BD01b0608a6B6d4f4E03aFfCe16c1FF19c23` | 
| MasterDeployer                                  | `0xEB4B1CE03bb947Ce23ABd1403dF7C9B86004178d` |
| PoolLogger                                      | `0x002A422533cccEeA9aBF9e56e2A25d72672891bC` | 
| PoolRouter                                      | `0x17Ac28a29670e637c8a6E1ec32b38fC301303E34` |  
| PositionDashboard                               | `0x6e1832b4791E195939C10C2A00b5A9456E337dA2` |
| SwapHelper                                      | `0xe80FE14d4c67598A2a8F107f1b95FECC2Bb08E7D` | 
| WETH10                                          | `0xFF3e7cf0C007f919807b32b30a4a9E7Bd7Bc4121` |
| MiningPoolFactory (custom pool)                 | `0x02d9bf2d4F5cEA981cB8a8B77A56B498C5da7Eb0` |
| YieldPoolFactory  (custom pool)                 | `0x6C7Fc36c3F2792Faf12a5Ba8aa12379c5D01986d` |
| MiningPoolManager (for MiningPool & YieldPool)  | `0xD32AEF55E87c8223752fCaedEe1b94D363282B96` |
| ClaimAggregator                                 | `0x185f0E25e0E540b3904A520971EbE914eE76e9b2` |


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
