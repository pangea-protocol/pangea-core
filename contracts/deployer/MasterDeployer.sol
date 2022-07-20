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
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IPoolLogger.sol";
import "../interfaces/IMasterDeployer.sol";

/// @notice Pool deployer contract with template factory whitelist
contract MasterDeployer is OwnableUpgradeable, IMasterDeployer {
    address public protocolFeeTo;
    address public airdropDistributor;

    mapping(address => bool) public pools;
    mapping(address => bool) public whitelistedFactories;

    address[] private poolArray;
    mapping(address => address) private factoryOf;

    error ZeroAddress();
    error NotAllowedFactory();
    error InvalidFee();

    function initialize(address _protocolFeeTo) external initializer {
        if (_protocolFeeTo == address(0)) revert ZeroAddress();
        protocolFeeTo = _protocolFeeTo;
        __Ownable_init();
    }

    /// @dev Depending on the characteristic of the tokens or protocols, a different type of pool may be required.
    ///      This structure makes it easy to create custom pools.
    function deployPool(address _factory, bytes calldata _deployData) external returns (address pool) {
        if (!whitelistedFactories[_factory]) revert NotAllowedFactory();

        pool = IPoolFactory(_factory).deployPool(_deployData);

        pools[pool] = true;
        poolArray.push(pool);
        factoryOf[pool] = _factory;

        emit DeployPool(_factory, pool, _deployData);
    }

    /// @notice Allows creation of pools through the pool factory, admin only
    function addToWhitelistFactory(address _factory) external onlyOwner {
        whitelistedFactories[_factory] = true;
        emit AddToWhitelistFactory(_factory);
    }

    /// @notice Disallows creation of pools through the pool factory, admin only
    function removeFromWhitelistFactory(address _factory) external onlyOwner {
        whitelistedFactories[_factory] = false;
        emit RemoveFromWhitelistFactory(_factory);
    }

    /// @notice set address to receive protocol Fee, admin only
    function setProtocolFeeTo(address _protocolFeeTo) external onlyOwner {
        if (_protocolFeeTo == address(0)) revert ZeroAddress();
        protocolFeeTo = _protocolFeeTo;
        emit ProtocolFeeToUpdated(_protocolFeeTo);
    }

    /// @notice set Airdrop Distributor Contract, admin only
    function setAirdropDistributor(address _airdropDistributor) external onlyOwner {
        if (_airdropDistributor == address(0)) revert ZeroAddress();
        airdropDistributor = _airdropDistributor;
    }

    /// @notice Return the number of pools deployed from masterDeployer
    function totalPoolsCount() external view returns (uint256 total) {
        return poolArray.length;
    }

    /// @notice Return the address of pool by index
    function getPoolAddress(uint256 idx) external view returns (address pool) {
        return poolArray[idx];
    }

    /// @notice Return the address of Factory deployed pool
    function getFactoryAddress(address pool) external view returns (address factory) {
        return factoryOf[pool];
    }
}
