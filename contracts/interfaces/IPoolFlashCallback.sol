// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IPoolFlashCallback {
    /// @notice Called to msg.sender after transferring to the recipient from Pool#flash
    /// @param fee0 The fee amount in token0 due to the pool by the end of the flash
    /// @param fee1 The fee amount in token1 due to the pool by the end of the flash
    /// @param data Any data passed through by the caller via the Pool#flash call
    function flashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external;
}
