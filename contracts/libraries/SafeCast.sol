//SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

library SafeCast {
    function toUint160(uint256 y) internal pure returns (uint160 z) {
        require((z = uint160(y)) == y);
    }

    function toUint128(uint256 y) internal pure returns (uint128 z) {
        require((z = uint128(y)) == y);
    }

    function toInt128(uint256 y) internal pure returns (int128 z) {
        require(y <= 2**127 - 1);
        return int128(int256(y));
    }
}
