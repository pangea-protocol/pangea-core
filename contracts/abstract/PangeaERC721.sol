// SPDX-License-Identifier: GPL-3.0

/*
 *
 * #####    ##   #    #  ####  ######   ##      #####  #####   ####  #####  ####   ####   ####  #
 * #    #  #  #  ##   # #    # #       #  #     #    # #    # #    #   #   #    # #    # #    # #
 * #    # #    # # #  # #      #####  #    #    #    # #    # #    #   #   #    # #      #    # #
 * #####  ###### #  # # #  ### #      ######    #####  #####  #    #   #   #    # #      #    # #
 * #      #    # #   ## #    # #      #    #    #      #   #  #    #   #   #    # #    # #    # #
 * #      #    # #    #  ####  ###### #    #    #      #    #  ####    #    ####   ####   ####  ######
 *
 */

pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "../interfaces/INFTDescriptor.sol";

abstract contract PangeaERC721 is ERC721EnumerableUpgradeable {
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)");

    bytes32 public constant PERMIT_ALL_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 nonce,uint256 deadline)");

    bytes32 internal _DOMAIN_SEPARATOR;

    uint256 internal DOMAIN_SEPARATOR_CHAIN_ID;

    INFTDescriptor internal descriptor;

    struct NFTCounter {
        uint128 minted;
        uint128 burned;
    }

    NFTCounter public nftCount;

    mapping(uint256 => uint256) public nonces;

    mapping(address => uint256) public noncesForAll;

    function __pangeaNFT_init() internal {
        __ERC721_init("Pangea Position", "PANGEA-POS");
        DOMAIN_SEPARATOR_CHAIN_ID = block.chainid;
        _DOMAIN_SEPARATOR = _calculateDomainSeparator();
        __ERC721Enumerable_init();
    }

    function _calculateDomainSeparator() internal view returns (bytes32 domainSeperator) {
        domainSeperator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PANGEA-POS")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32 domainSeperator) {
        domainSeperator = block.chainid == DOMAIN_SEPARATOR_CHAIN_ID ? _DOMAIN_SEPARATOR : _calculateDomainSeparator();
    }

    function mint(address recipient) internal {
        _mint(recipient, nftCount.minted++);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        return descriptor.tokenURI(tokenId);
    }

    function burn(uint256 tokenId) internal {
        nftCount.burned++;
        _burn(tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override {
        require(to != 0x000000000000000000000000000000000000dEaD, "ERC721: transfer to the klip DEAD address");
        super._beforeTokenTransfer(from, to, tokenId);
    }

    function totalSupply() public view override returns (uint256) {
        return nftCount.minted - nftCount.burned;
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }

    function permit(
        address spender,
        uint256 tokenId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(deadline >= block.timestamp, "PERMIT_DEADLINE_EXPIRED");
        address owner = ownerOf(tokenId);
        /// @dev This is reasonably safe from overflow - incrementing `nonces` beyond
        // 'type(uint256).max' is exceedingly unlikely compared to optimization benefits.
        unchecked {
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(PERMIT_TYPEHASH, spender, tokenId, nonces[tokenId]++, deadline))
                )
            );
            address recoveredAddress = ecrecover(digest, v, r, s);
            require(recoveredAddress != address(0), "INVALID_PERMIT_SIGNATURE");
            require(recoveredAddress == owner || isApprovedForAll(owner, recoveredAddress), "INVALID_SIGNER");
        }
        _approve(spender, tokenId);
    }

    function permitAll(
        address owner,
        address operator,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(deadline >= block.timestamp, "PERMIT_DEADLINE_EXPIRED");
        /// @dev This is reasonably safe from overflow - incrementing `nonces` beyond
        // 'type(uint256).max' is exceedingly unlikely compared to optimization benefits.
        unchecked {
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(PERMIT_ALL_TYPEHASH, owner, operator, noncesForAll[owner]++, deadline))
                )
            );
            address recoveredAddress = ecrecover(digest, v, r, s);
            require(
                (recoveredAddress != address(0) && recoveredAddress == owner) || isApprovedForAll(owner, recoveredAddress),
                "INVALID_PERMIT_SIGNATURE"
            );
        }
        _setApprovalForAll(owner, operator, true);
    }
}
