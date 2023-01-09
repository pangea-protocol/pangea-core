// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IConcentratedLiquidityPoolManager.sol";

interface KlipRecoveryCallee {
    function recoverFromKlipDead(uint256 tokenId, address to) external;
}

contract DeadAddressRecovery is Ownable {
    address public poolManager = 0xD32AEF55E87c8223752fCaedEe1b94D363282B96;
    address public klipDeadAddress = 0x000000000000000000000000000000000000dEaD;

    mapping(uint256 => address) public originalOwnerOf;

    event Recover(uint256 tokenId, address owner);
    event Register(uint256 tokenId, address owner);

    function recover(uint256 tokenId) external {
        require(IConcentratedLiquidityPoolManager(poolManager).ownerOf(tokenId) == klipDeadAddress, "NOT DEAD ADDRESS");
        require(originalOwnerOf[tokenId] == msg.sender, "NOT ORIGINAL OWNER");
        KlipRecoveryCallee(poolManager).recoverFromKlipDead(tokenId, msg.sender);

        emit Recover(tokenId, msg.sender);
    }

    function registerOriginalOwner(address owner, uint256 tokenId) external onlyOwner {
        originalOwnerOf[tokenId] = owner;

        emit Register(tokenId, owner);
    }
}
