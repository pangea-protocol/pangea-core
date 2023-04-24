// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IGCKlay is IERC20 {
    function totalShares() external view returns (uint256);

    function sharesOf(address user) external view returns (uint256);
}
