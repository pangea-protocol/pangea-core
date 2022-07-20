// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Test is ERC20 {
    uint8 internal immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address recipient, uint256 amount) public {
        _mint(recipient, amount);
    }

    function burn(address recipient, uint256 amount) public {
        _burn(recipient, amount);
    }

    function burnAll(address recipient) public {
        _burn(recipient, balanceOf(recipient));
    }
}
