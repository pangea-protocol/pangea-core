// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

contract MockStaking {

    receive() external payable {}

    function stake() external payable {}

    function unstake(address recipient, uint256 amount) external {
        address(recipient).call{value:amount}("");
    }
}
