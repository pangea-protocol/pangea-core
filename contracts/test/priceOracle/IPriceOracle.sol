// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IPriceOracle {
    function DECIMAL() external view returns (uint256 decimal);

    function consultKlayPrice() external view returns (uint256 price);

    function consultPrice(address token) external view returns (uint256 price);
}
