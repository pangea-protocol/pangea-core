// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

/// @notice Pool deployment interface.
interface IPoolFactory {
    function deployPool(bytes calldata _deployData) external returns (address pool);

    function configAddress(bytes32 data) external returns (address pool);

    function isPool(address pool) external returns (bool ok);
}
