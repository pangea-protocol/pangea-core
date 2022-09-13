// SPDX-License-Identifier: GPL-3.0

/*
 *
 * #####    ##   #    #  ####  ######   ##      #####  #####   ####  #####  ####   ####   ####  #
 * #    #  #  #  ##   # #    # #       #  #     #    # #    # #    #   #   #    # #    # #    # #
 * #    # #    # # #  # #      #####  #    #    #    # #    # #    #   #   #    # #      #    # #
 * #####  ###### #  # # #  ### #      ######    #####  #####  #    #   #   #    # #      #    # #
 * #      #    # #   ## #    # #      #    #    #      #   #  #    #   #   #    # #    # #    # #
 * #      #    # #    #  ####  ###### #    #    #      #    #  ####    #    ####   ####   ####  ######
 *
 */

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IPoolFactoryCallee.sol";
import "../interfaces/IConcentratedLiquidityPoolFactory.sol";
import "./ConcentratedLiquidityPool.sol";
import "./PoolFactoryLib.sol";

/// @notice Contract for deploying Concentrated Liquidity Pool
contract ConcentratedLiquidityPoolFactory is OwnableUpgradeable, IConcentratedLiquidityPoolFactory {
    address public masterDeployer;
    address public poolLogger;

    mapping(address => mapping(address => address[])) public pools;
    mapping(bytes32 => address) public configAddress;
    mapping(address => bool) public isPool;
    mapping(uint24 => mapping(uint24 => bool)) public availableFeeAndTickSpacing;

    address[] private poolArray;

    error WrongTokenOrder();
    error UnauthorisedDeployer();
    error ZeroAddress();
    error InvalidFeeAndTickSpacing();

    event UpdateAvailableFeeAndTickSpacing(uint24 fee, uint24 tickSpacing, bool ok);

    function initialize(address _masterDeployer, address _poolLogger) external initializer {
        if (_masterDeployer == address(0)) revert ZeroAddress();
        if (_poolLogger == address(0)) revert ZeroAddress();
        masterDeployer = _masterDeployer;
        poolLogger = _poolLogger;

        availableFeeAndTickSpacing[10_000][100] = true; // swapFee = 1.0%  / tickSpacing = 100
        availableFeeAndTickSpacing[2_000][20] = true; // swapFee = 0.2%  / tickSpacing =  20
        availableFeeAndTickSpacing[600][6] = true; // swapFee = 0.06% / tickSpacing =   6
        availableFeeAndTickSpacing[100][1] = true; // swapFee = 0.01% / tickSpacing =   1

        __Ownable_init();
    }

    function setAvailableFeeAndTickSpacing(
        uint24 fee,
        uint24 tickSpacing,
        bool ok
    ) external onlyOwner {
        availableFeeAndTickSpacing[fee][tickSpacing] = ok;

        emit UpdateAvailableFeeAndTickSpacing(fee, tickSpacing, ok);
    }

    function deployPool(bytes memory _deployData) external returns (address pool) {
        if (msg.sender != masterDeployer) revert UnauthorisedDeployer();

        (address tokenA, address tokenB, uint24 swapFee, uint160 price, uint24 tickSpacing) = abi.decode(
            _deployData,
            (address, address, uint24, uint160, uint24)
        );

        // Revert instead of switching tokens and inverting price.
        if (tokenA > tokenB) revert WrongTokenOrder();
        if (!availableFeeAndTickSpacing[swapFee][tickSpacing]) revert InvalidFeeAndTickSpacing();

        // Strips any extra data.
        // Don't include price in _deployData to enable predictable address calculation.
        _deployData = abi.encode(tokenA, tokenB, swapFee, tickSpacing);
        bytes32 salt = keccak256(_deployData);
        pool = PoolFactoryLib.createPool(_deployData, masterDeployer);

        configAddress[salt] = pool;
        pools[tokenA][tokenB].push(pool);
        pools[tokenB][tokenA].push(pool);
        isPool[pool] = true;
        poolArray.push(pool);

        IPoolFactoryCallee(pool).setPrice(price);
        IPoolFactoryCallee(pool).registerLogger(poolLogger);
    }

    function totalPoolsCount() external view returns (uint256 total) {
        return poolArray.length;
    }

    function getPoolAddress(uint256 idx) external view returns (address pool) {
        return poolArray[idx];
    }

    function poolsCount(address token0, address token1) external view returns (uint256 count) {
        count = pools[token0][token1].length;
    }

    function getPools(
        address token0,
        address token1,
        uint256 startIndex,
        uint256 count
    ) external view returns (address[] memory pairPools) {
        pairPools = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            pairPools[i] = pools[token0][token1][startIndex + i];
        }
    }
}
