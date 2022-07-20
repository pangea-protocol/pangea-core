// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface INFTDescriptor {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
