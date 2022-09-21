// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IClaimCallee is IERC721 {
    function collect(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external returns (uint256 token0Amount, uint256 token1Amount);

    function collectReward(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external returns (uint256 rewardAmount);
}
