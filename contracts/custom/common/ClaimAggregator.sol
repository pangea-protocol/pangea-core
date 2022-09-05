// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../../abstract/PangeaBatchable.sol";
import "./interfaces/IClaimCallee.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/// @notice Aggregating Claim Fee & reward in single TX. There are multiple position managers in Pangea Swap.
contract ClaimAggregator is PangeaBatchable, ReentrancyGuardUpgradeable {

    error NotAllowed();

    function initialize() external initializer {
        __ReentrancyGuard_init();
    }

    function collect(
        address poolManager,
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external nonReentrant returns (uint256 token0Amount, uint256 token1Amount) {
        if (!isOwner(poolManager, msg.sender, positionId)) revert NotAllowed();
        return IClaimCallee(poolManager).collect(positionId, recipient, unwrap);
    }

    function collectReward(
        address poolManager,
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external nonReentrant returns (uint256 rewardAmount) {
        if (!isOwner(poolManager, msg.sender, positionId)) revert NotAllowed();
        return IClaimCallee(poolManager).collectReward(positionId, recipient, unwrap);
    }

    function isOwner(
        address poolManager,
        address spender,
        uint256 tokenId
    ) internal view returns (bool) {
        address owner = IClaimCallee(poolManager).ownerOf(tokenId);
        return spender == owner;
    }
}
