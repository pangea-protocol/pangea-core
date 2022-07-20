import "dotenv/config";
import "@nomiclabs/hardhat-solhint";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-contract-sizer";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "hardhat-interface-generator";
import "hardhat-abi-exporter";
import "hardhat-spdx-license-identifier";
import "hardhat-tracer";
import '@primitivefi/hardhat-dodoc';
import "solidity-coverage";
import "./tasks";

import { HardhatUserConfig } from "hardhat/config";
import { removeConsoleLog } from "hardhat-preprocessor";

const accounts = {
  mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk",
};

const config: HardhatUserConfig = {
  defaultNetwork: process.env.NETWORK ? process.env.NETWORK : "localhost",
  gasReporter: {
    currency: "ETH",
    gasPrice: 250,
    enabled: true,
  },
  networks: {
    localhost: {
      live: false,
      chainId:31337,
      saveDeployments: true,
      tags: ["local"],
    },
    hardhat: {
      allowUnlimitedContractSize:true,
      live: false,
      chainId:31337,
      saveDeployments: true,
      tags: ["test", "local"],
      gasPrice: 250000000000,
      accounts: {
        // 1,000,000,000
        accountsBalance: "10000000000000000000000000000"
      },
      // Solidity-coverage overrides gasPrice to 1 which is not compatible with EIP1559
      hardfork: process.env.CODE_COVERAGE ? "berlin" : "london",
    },
    baobab: {
      chainId: 1001,
      url: 'https://kaikas.baobab.klaytn.net:8651/',
      accounts,
      gasPrice: 250000000000
    },
    cypress: {
      chainId: 8217,
      url: 'https://ken.stick.us/',
      accounts,
      gasPrice: 250000000000
    },
  },
  // to build a test environment, not for live deployment
  namedAccounts: {
    deployer: {
      default: 0,
    },
    dev: {
      default: 1,
    },
    protocolFeeTo: {
      default: 2,
    },
    user100 : {
      default: 3,
    },
    user101 : {
      default: 4,
    },
    user102 : {
      default: 5,
    },
    user103 : {
      default: 6,
    },
    user104 : {
      default: 7,
    },
    user105 : {
      default: 8,
    },
    user106 : {
      default: 9,
    },
    user107 : {
      default: 10,
    }
  },
  paths: {
    artifacts: "artifacts",
    cache: "cache",
    deploy: "deploy",
    deployments: "deployments",
    imports: "imports",
    sources: "contracts",
    tests: "test",
  },
  preprocess: {
    eachLine: removeConsoleLog((bre) => bre.network.name !== "hardhat" && bre.network.name !== "localhost"),
  },
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 99999,
          },
        },
      }
    ],
    settings: {
      outputSelection: {
        "*": {
          "*": ["storageLayout"]
        }
      }
    },
    overrides: {
      "contracts/pool/PoolFactoryLib.sol": {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 5000,
          },
        }
      },
      "contracts/pool/ConcentratedLiquidityPool.sol": {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        }
      },
      "contracts/pool/ConcentratedLiquidityPoolManager.sol": {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        }
      }
    }
  },
  dodoc: {
    runOnCompile: false,
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
  mocha: {
    timeout: 300000,
  },
  abiExporter: {
    path: 'deployments/abis',
    runOnCompile: true,
    clear: true,
    flat: true,
    spacing: 2,
    pretty: false,
  }
};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
export default config;
