// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

/// @notice pool interface called by factory contract
interface IPoolFactoryCallee {
    function setPrice(uint160 price) external;

    function registerLogger(address logger) external;
}
