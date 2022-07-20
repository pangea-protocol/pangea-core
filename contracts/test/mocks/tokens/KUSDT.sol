// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract KUSDT is ERC20 {
    constructor() ERC20("Orbit Bridge Klaytn USD Tether", "KUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }
}
