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
import "../../interfaces/IConcentratedLiquidityPool.sol";
import "./interfaces/IProtocolFeeSetter.sol";

/// @notice Contract for deploying Reward Liquidity Pool
contract MiningPoolFactory is OwnableUpgradeable, IConcentratedLiquidityPoolFactory {
    address public masterDeployer;
    address public poolLogger;
    address public manager;
    address private poolImplementation;

    mapping(address => mapping(address => address[])) public pools;
    mapping(bytes32 => address) public configAddress;
    mapping(bytes32 => bool) private availableConfigs; // useless fields...
    mapping(address => bool) public isPool;

    address[] private poolArray;
    uint256 public defaultProtocolFee;

    mapping(uint24 => mapping(uint24 => bool)) public availableFeeAndTickSpacing;

    event UpdatePoolImplementation(address previousImplementation, address newImplementation);
    event UpdateProtocolFee(address pool, uint256 protocolFee);
    event UpdateDefaultProtocolFee(uint256 protocolFee);
    event UpdateAvailableFeeAndTickSpacing(uint24 fee, uint24 tickSpacing, bool ok);

    error WrongTokenOrder();
    error UnauthorisedDeployer();
    error UnauthorisedManager();
    error InvalidToken();
    error InvalidConfig();
    error ZeroAddress();
    error InvalidFeeAndTickSpacing();

    modifier onlyManager() {
        if (manager != _msgSender()) revert UnauthorisedManager();
        _;
    }

    function initialize(
        address _implementation,
        address _masterDeployer,
        address _poolLogger
    ) external initializer {
        if (_implementation == address(0)) revert ZeroAddress();
        if (_masterDeployer == address(0)) revert ZeroAddress();
        if (_poolLogger == address(0)) revert ZeroAddress();
        poolImplementation = _implementation;
        masterDeployer = _masterDeployer;
        poolLogger = _poolLogger;

        defaultProtocolFee = 1000;

        availableFeeAndTickSpacing[10_000][100] = true; // swapFee = 1.0%  / tickSpacing = 100
        availableFeeAndTickSpacing[2_000][20] = true; // swapFee = 0.2%  / tickSpacing =  20
        /// @dev why not set the tick spacing to 1? To avoid truncation errors on the client side(UX).
        availableFeeAndTickSpacing[600][2] = true; // swapFee = 0.06% / tickSpacing =   2
        availableFeeAndTickSpacing[100][2] = true; // swapFee = 0.01% / tickSpacing =   2

        __Ownable_init();
        manager = _msgSender();
    }

    function deployPool(bytes memory _deployData) external returns (address pool) {
        if (msg.sender != masterDeployer) revert UnauthorisedDeployer();

        (address tokenA, address tokenB, uint24 swapFee, uint160 price, uint24 tickSpacing) = abi.decode(
            _deployData,
            (address, address, uint24, uint160, uint24)
        );

        if (tokenA > tokenB) revert WrongTokenOrder();
        if (!availableFeeAndTickSpacing[swapFee][tickSpacing]) revert InvalidFeeAndTickSpacing();
        address[] memory _pools = pools[tokenA][tokenB];

        for (uint256 i = 0; i < _pools.length; i++) {
            if (
                IConcentratedLiquidityPool(_pools[i]).tickSpacing() == tickSpacing &&
                IConcentratedLiquidityPool(_pools[i]).swapFee() == swapFee
            ) {
                revert InvalidConfig();
            }
        }

        // Strips any extra data.
        // Don't include price in _deployData to enable predictable address calculation.
        _deployData = abi.encode(tokenA, tokenB, address(0), swapFee, tickSpacing);
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

    function setAvailableFeeAndTickSpacing(
        uint24 fee,
        uint24 tickSpacing,
        bool ok
    ) external onlyManager {
        availableFeeAndTickSpacing[fee][tickSpacing] = ok;

        emit UpdateAvailableFeeAndTickSpacing(fee, tickSpacing, ok);
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
