// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IYieldToken is IERC20 {
    function totalShares() external view returns (uint256);

    function totalStaking() external view returns (uint256);

    function totalRestaked() external view returns (uint256);

    function stake() external payable;

    function stakeFor(address recipient) external payable;

    function unstake(uint256 amount) external;

    function claim() external;

    function claimTo(address to) external;

    function increaseTotalStaking(uint256 amount) external;

    function getSharesByKlay(uint256 amount) external view returns (uint256);

    function getKlayByShares(uint256 amount) external view returns (uint256);

    function sharesOf(address user) external view returns (uint256);
}
