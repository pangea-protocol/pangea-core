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
import "../../interfaces/IPoolFactoryCallee.sol";
import "../../interfaces/IConcentratedLiquidityPoolFactory.sol";
import "../common/vendor/EIP173Proxy.sol";
import "../common/interfaces/IEIP173Proxy.sol";
import "../common/interfaces/ICustomPool.sol";
import "../miningPool/interfaces/IProtocolFeeSetter.sol";

/// @notice Contract for deploying Reward Liquidity Pool
contract YieldPoolFactory is OwnableUpgradeable, IConcentratedLiquidityPoolFactory {
    address public masterDeployer;
    address public poolLogger;
    address public manager;
    address private poolImplementation;
    address public yieldToken;

    mapping(address => mapping(address => address[])) public pools;
    mapping(bytes32 => address) public configAddress;
    mapping(bytes32 => bool) public availableConfigs;
    mapping(address => bool) public isPool;

    address[] private poolArray;
    uint256 public defaultProtocolFee;

    event UpdatePoolImplementation(address previousImplementation, address newImplementation);
    event UpdateProtocolFee(address pool, uint256 protocolFee);
    event UpdateDefaultProtocolFee(uint256 protocolFee);

    error WrongTokenOrder();
    error UnauthorisedDeployer();
    error UnauthorisedManager();
    error InvalidToken();
    error InvalidConfig();
    error ZeroAddress();

    modifier onlyManager() {
        if (manager != _msgSender()) revert UnauthorisedManager();
        _;
    }

    function initialize(
        address _implementation,
        address _masterDeployer,
        address _poolLogger,
        address _yieldToken
    ) external initializer {
        if (_implementation == address(0)) revert ZeroAddress();
        if (_masterDeployer == address(0)) revert ZeroAddress();
        if (_poolLogger == address(0)) revert ZeroAddress();
        poolImplementation = _implementation;
        masterDeployer = _masterDeployer;
        poolLogger = _poolLogger;
        yieldToken = _yieldToken;

        defaultProtocolFee = 1000;

        __Ownable_init();
        manager = _msgSender();
    }

    function deployPool(bytes memory _deployData) external returns (address pool) {
        if (msg.sender != masterDeployer) revert UnauthorisedDeployer();

        (address tokenA, address tokenB, address rewardToken, uint24 swapFee, uint160 price, uint24 tickSpacing) = abi.decode(
            _deployData,
            (address, address, address, uint24, uint160, uint24)
        );

        if (!availableConfigs[keccak256(abi.encode(tokenA, tokenB, rewardToken, swapFee, tickSpacing))]) revert InvalidConfig();

        // Strips any extra data.
        // Don't include price in _deployData to enable predictable address calculation.
        _deployData = abi.encode(tokenA, tokenB, rewardToken, swapFee, tickSpacing, tokenA == yieldToken);
        bytes32 salt = keccak256(_deployData);

        pool = address(new EIP173Proxy{salt: salt}(poolImplementation, address(this), ""));
        ICustomPool(pool).initialize(_deployData, masterDeployer);

        configAddress[salt] = pool;
        pools[tokenA][tokenB].push(pool);
        pools[tokenB][tokenA].push(pool);
        isPool[pool] = true;
        poolArray.push(pool);

        IPoolFactoryCallee(pool).setPrice(price);
        IPoolFactoryCallee(pool).registerLogger(poolLogger);
        IProtocolFeeSetter(pool).setProtocolFee(defaultProtocolFee);
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

    function setAvailableParameter(
        address tokenA,
        address tokenB,
        address rewardToken,
        uint24 swapFee,
        uint24 tickSpacing
    ) external onlyManager {
        if (tokenA >= tokenB) revert WrongTokenOrder();
        if (tokenA != yieldToken && tokenB != yieldToken) revert InvalidToken();
        if (tokenA == rewardToken || tokenB == rewardToken) revert InvalidToken();

        bytes memory _deployData = abi.encode(tokenA, tokenB, rewardToken, swapFee, tickSpacing);
        availableConfigs[keccak256(_deployData)] = true;
    }

    function setDefaultProtocolFee(uint256 protocolFee) external onlyManager {
        defaultProtocolFee = protocolFee;

        emit UpdateDefaultProtocolFee(protocolFee);
    }

    function setProtocolFee(address pool, uint256 protocolFee) external onlyManager {
        IProtocolFeeSetter(pool).setProtocolFee(protocolFee);

        emit UpdateProtocolFee(pool, protocolFee);
    }

    function setManager(address _manager) external onlyManager {
        manager = _manager;
    }

    function setPoolImplementation(address nextImplementation) external onlyManager {
        emit UpdatePoolImplementation(poolImplementation, nextImplementation);
        poolImplementation = nextImplementation;
    }

    function upgradePools(address[] memory _pools) external onlyManager {
        address _implementation = poolImplementation;
        for (uint256 i = 0; i < _pools.length; i++) {
            IEIP173Proxy(_pools[i]).upgradeTo(_implementation);
        }
    }

    function upgradePoolsAndCall(address[] memory _pools, bytes[] calldata datas) external onlyManager {
        address _implementation = poolImplementation;
        require(_pools.length == datas.length, "mismatching array length");
        for (uint256 i = 0; i < _pools.length; i++) {
            IEIP173Proxy(_pools[i]).upgradeToAndCall(_implementation, datas[i]);
        }
    }
}
