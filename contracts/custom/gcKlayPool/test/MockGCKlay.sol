// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './SharesMath.sol';
import '../../../libraries/FullMath.sol';

/**
 * @title MockGCKlay
 * @author Swapscanner
 * @notice  This contract extends ERC20VotesCustomBalance to allow programmatic balance updates.
 *
 * @dev Balance will be calculated based on shares, which could be minted or burned.
 *
 * Extending contracts should implement the {_totalSupply} function, which should return
 * the total amount of tokens that {totalShares} represents.
 *
 * NOTE: {value} of {_beforeTokenTransfer(, , value)}, {_afterTokenTransfer(, , value)} will be
 * passed as {shares} instead of the actual amount of tokens. This is to properly support
 * checkpoint mechanism of {ERC20Votes}. BEWARE when using other ERC20 extensions that rely on
 * {value} of {_beforeTokenTransfer(, , value)} and {_afterTokenTransfer(, , value)}.
 *
 * Unlike above, {value} of {event Transfer(, , value)} will be passed as
 * the actual amount of tokens.
 */
contract MockGCKlay is ERC20 {
    error AmountTooSmall();
    error TransferAddressZero();
    error InsufficientBalance();
    error NotAllowed();

    mapping(address => uint256) private _shares;
    uint256 private _totalShares;

    // for mocking
    address public cnStaking = address(2);

    receive() external payable {}

    constructor() ERC20("MOCK GCKlay", "MGCKlay") {
    }

    /**
     * @dev This function should return the total amount of tokens that {totalShares} represents.
   */
    function _totalSupply() internal view returns (uint256) {
        return address(cnStaking).balance + address(this).balance;
    }

    /// implementations

    /**
     * @notice Returns the amount of shares owned by {account}.
   */
    function sharesOf(address account) public view returns (uint256) {
        return _shares[account];
    }

    /**
     * @notice Returns the total amount of shares.
   */
    function totalShares() public view returns (uint256) {
        return _totalShares;
    }

    function _burnAmount(address account, uint256 amount) internal returns (uint256 burnedAmount) {
        uint256 balance = balanceOf(account);
        uint256 currentShares = _shares[account];
        // balance == amount comparison is valid way to burn all the shares when the amount is equals
        // to the user's balance. this is to mitigate any potential rounding errors.
        // balance < amount will cause revert with {InsufficientBalance} anyways.
        // slither-disable-next-line incorrect-equality
        return
        _burnShares(
            account,
            currentShares,
            balance == amount
            ? currentShares
            : SharesMath.calculateShares(amount, _totalSupply(), _totalShares),
            amount
        );
    }

    function _burnShares(address account, uint256 shares) internal returns (uint256 burnedAmount) {
        return
        _burnShares(
            account,
            _shares[account],
            shares,
            SharesMath.calculateAmount(shares, totalSupply(), _totalShares)
        );
    }

    /**
     * @dev Burns corresponding shares for the {account} for the {amount}.
   * @param account The address to burn shares from.
   * @param currentShares The current shares of the {account}.
   * @param shares The amount of shares to burn.
   * @param amount The amount of tokens to burn.
   *
   * NOTE: Followings are not checked in this function.
   * Caller is responsible of providing a sane value:
   * - {currentShares} MUST be equal to {sharesOf(account)}.
   * - {shares} and {amount} should be in valid ratio.
   */
    function _burnShares(
        address account,
        uint256 currentShares,
        uint256 shares,
        uint256 amount
    ) private returns (uint256 burnedAmount) {
        if (shares < 1) revert AmountTooSmall();

        _beforeTokenTransfer(account, address(0), shares);

        if (currentShares < shares) revert InsufficientBalance();
    unchecked {
        _shares[account] = currentShares - shares;
        // Overflow not possible: shares <= currentShares <= totalShares
        _totalShares -= shares;
    }

        // burn
        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), shares);

        return amount;
    }

    /**
     * @dev Mints corresponding shares for the {recipient} for the {amount}.
     * @param recipient The address to mint shares to.
     * @param amount The amount of tokens to mint shares for.
     *
     * @dev NOTE: {_totalSupply()} must be increased at least by {amount}
     * before calling this function.
   */
    function _mintSharesForAmount(address recipient, uint256 amount) internal {
        _mintSharesForAmount(recipient, amount, _totalSupply() - amount);
    }

    /**
     * @dev Mints corresponding shares for the {recipient} for the {amount}.
   * @param recipient The address to mint shares to.
   * @param amount The amount of tokens to mint shares for.
   * @param totalSupplyOverride The total supply to use for calculating shares.
   *
   * @dev Total supply can be overridden to calculate shares based on a different total supply.
   * This is useful when the {_totalSupply()} is already updated before calling this function.
   *
   * NOTE: {totalSupplyOverride} should be less than or equal to {_totalSupply()}.
   */
    function _mintSharesForAmount(
        address recipient,
        uint256 amount,
        uint256 totalSupplyOverride
    ) internal {
        if (recipient == address(0)) revert TransferAddressZero();

        uint256 shares = SharesMath.calculateShares(amount, totalSupplyOverride, _totalShares);
        if (shares < 1) revert AmountTooSmall();

        _beforeTokenTransfer(address(0), recipient, shares);

        _totalShares += shares;
    unchecked {
        // Overflow not possible: currentShare + shares is at most totalShares + shares,
        // which is checked above.
        _shares[recipient] += shares;
    }

        // mint
        emit Transfer(address(0), recipient, amount);

        _afterTokenTransfer(address(0), recipient, shares);
    }

    /**
     * @dev Moves {amount} of tokens from {from} to {to}.
   *
   * This internal function is equivalent to {transfer}, and can be used to
   * e.g. implement automatic token fees, slashing mechanisms, etc.
   *
   * It transfers {shares} internally, and emits a {Transfer} event with {amount}.
   *
   * Emits a {Transfer} event.
   *
   * Requirements:
   *
   * - {from} cannot be the zero address.
   * - {to} cannot be the zero address.
   * - {from} must have a balance of at least `amount`.
   */
    function _transfer(address from, address to, uint256 amount) internal virtual override {
        if (from == address(0)) revert TransferAddressZero();
        if (to == address(0)) revert TransferAddressZero();

        uint256 cachedTotalSupply = _totalSupply();
        uint256 fromShares = _shares[from];
        uint256 shares;
        // not using {balanceOf} to avoid an extra SLOAD
        // slither-disable-next-line incorrect-equality
        if (_computeBalance(fromShares, cachedTotalSupply, _totalShares) == amount) {
            // edge case: if the entire balance is being transferred,
            // the entire shares should be transferred.
            shares = _shares[from];
        } else {
            shares = SharesMath.calculateShares(amount, cachedTotalSupply, _totalShares);
        }

        _beforeTokenTransfer(from, to, shares);

        if (fromShares < shares) revert InsufficientBalance();
    unchecked {
        _shares[from] = fromShares - shares;
        // Overflow not possible: the sum of all shares is capped by totalShares,
        // and the sum is preserved by decrementing then incrementing.
        _shares[to] += shares;
    }

        emit Transfer(from, to, amount);

        _afterTokenTransfer(from, to, shares);
    }

    /// ERC20

    /**
     * @notice See {IERC20-totalSupply}.
   */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply();
    }

    /**
     * @notice See {IERC20-balanceOf}.
   */
    function balanceOf(address account) public view override returns (uint256) {
        return _computeBalance(_shares[account], _totalSupply(), _totalShares);
    }

    function _computeBalance(
        uint256 shares,
        uint256 totalSupplyOverride,
        uint256 totalSharesOverride
    ) internal pure returns (uint256) {
        return SharesMath.calculateAmount(shares, totalSupplyOverride, totalSharesOverride);
    }

    /// Forbidden methods

    function _mint(address, uint256) internal pure override {
        revert NotAllowed();
    }

    function _burn(address, uint256) internal pure override {
        revert NotAllowed();
    }

    /**
     * @notice Stakes native tokens to the {cnStaking} and increases their shares accordingly.
   *
   * @dev Emits a {Transfer} event with {from} set to the zero address (minting).
   */
    function stake() public payable {
        _sweepAndStake(_msgSender(), msg.value);
    }

    /**
     * @notice Stakes native tokens to the {cnStaking} and increases {recipient}'s shares accordingly.
   *
   * @dev Emits a {Transfer} event with {from} set to the zero address (minting).
   */
    function stakeFor(address recipient) external payable {
        _sweepAndStake(recipient, msg.value);
    }

    /**
     * @notice Sweeps the entire balance of the contract and stakes it as a reward for staked assets.
   * This function assumes that the entire balance is a reward.
   */
    function sweep() public {
        _sweepAndStake(address(0), 0);
    }

    /**
     * @dev Sweeps the entire native token balance of the contract and stakes it.
   * It then settles the fee and staking amount by minting corresponding shares.
   *
   * @param stakingRecipient - The recipient of the staking amount, if any.
   * @param amountToBeStaked - The amount of native token to be staked, if any.
   */
    function _sweepAndStake(address stakingRecipient, uint256 amountToBeStaked) private {
        // _stake() must be called before _mintSharesForNativeAmount() to prevent reentrancy.
        uint256 amountToBeSweeped = address(this).balance;
        if (amountToBeSweeped < 1) return;

        _stake(amountToBeSweeped);

        if (amountToBeStaked > 0) {
            _mintSharesForAmount(stakingRecipient, amountToBeStaked);
        }
    }

    function _stake(uint256 amount) internal virtual {
        // slither-disable-next-line arbitrary-send-eth
        cnStaking.call{value:amount}('');
    }
}
