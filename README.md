# PANGEA-Protocol : Next Generation Exchange with Concentrated Liquidity Pool

This repository contains the core smart contracts(Concentrated Liquidity Pool) for the PANGEA Protocol. In-depth documentation on Pangea is available at [pangea docs](https://pangea.gitbook.io/pangea-kr/overview/undefined).

### Addresses

#### Baobab

| contract | address |
| ---      | ----    |
| AirdropDistributor | 0x4Ab0b755f748FF98cE55aC0482CB28F29cCC01EA | 
| ConcentratedLiquidityPoolFactory | 0x0846b68C4C72C8940B402217CDfD63706071bEc5 | 
| ConcentratedLiquidityPoolHelper | 0xeDb36f4b7dEA02e213eD7928f83E0e51F6bA7F51 | 
| ConcentratedLiquidityPoolManager | 0xdd042114Dd4C6a0CF0C09b396957EAFa160258a6 | 
| MasterDeployer | 0xA0eb50178277596A709Bd1542ea1942e942E2C84 | 
| PoolDashboard | 0x0D0503Cd0768268fd2586d3eae2C4053F91FE806 | 
| PoolLogger | 0x09180a88Eb9e6d1b1258023697a9eED0588Fee11 | 
| PoolRouter | 0xcDF21AC0B04715dB4f4d37adE2C394a6efe30B37 | 
| PositionDashboard | 0xECB43Cd623785e0aFd1bAe7bB24f6bBc95F2dCC3 | 
| SwapHelper | 0x9E2fFC3414e0b98d3c985924dE51c6a35D47795E | 
| WETH10 | 0x3e825cbA8d59Eb0E62A24Db1A8F85158d30A26c3 | 


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

* [HACHI LABS audit](https://docs.google.com/document/d/1Fy7IkDYjPPz4uEGLaDhGLc7vgMEKlFDiOpxYIa7hLIU/edit?usp=sharing)
