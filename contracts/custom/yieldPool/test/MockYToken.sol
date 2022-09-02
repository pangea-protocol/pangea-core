// SPDX-License-Identifier: GPL 3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../../libraries/FullMath.sol";

/// @notice For Test
contract MockYToken is ERC20 {
    /// @notice Total amount of shares in this contract
    uint256 public totalShares;
    /// @notice Total staked through this contract including restaked amount
    uint256 public totalStaking;

    uint256 public liquidityIndex = 10 ** 18;

    /// @notice Amount of shares for each user
    mapping(address => uint256) private shares;

    ///////////////////////////////////////////////////////////////////
    //     Initializer / Modifiers
    ///////////////////////////////////////////////////////////////////
    constructor() ERC20("MOCK", "MOCK") {}

    receive() external payable {}

    ///////////////////////////////////////////////////////////////////
    //     External Functions
    ///////////////////////////////////////////////////////////////////

    /**
     * @notice Deposits for sender
     */
    function stake() external payable {
        _stake(_msgSender(), msg.value);
    }

    /**
     * @notice Deposits for designated address
     * @param recipient address to deposit for
     */
    function stakeFor(address recipient) external payable {
        _stake(recipient, msg.value);
    }

    /**
     * @notice Requests unstaking to sender
     * @param amount amount to unstake
     */
    function unstake(uint256 amount) external {
        _unstake(amount);
    }

    /**
     * @notice Increases totalStaking value due to re-staking of rewards
     * @param amount amount of re-staking rewards
     */
    function increaseTotalStaking(uint256 amount) external {
        totalStaking += amount;
        if (totalShares > 0) liquidityIndex = (totalStaking * 10**27) / totalShares;
    }

    ///////////////////////////////////////////////////////////////////
    //     External Functions (View)
    ///////////////////////////////////////////////////////////////////

    /**
     * @notice Returns amount of yToken for corresponding shares
     * @dev Shares --> Klay
     * @param amount amount of shares to convert
     */
    function getSharesByKlay(uint256 amount) external view returns (uint256) {
        return _getSharesByKlay(amount);
    }

    /**
     * @notice Returns amount of shares for corresponding yToken
     * @dev Klay --> Shares
     * @param amount amount of yToken to convert
     */
    function getKlayByShares(uint256 amount) external view returns (uint256) {
        return _getKlayByShares(amount);
    }

    ///////////////////////////////////////////////////////////////////
    //     Public Functions
    ///////////////////////////////////////////////////////////////////

    /**
     * @notice Returns user balance in yToken amount
     */
    function balanceOf(address user) public view override returns (uint256) {
        return _getKlayByShares(sharesOf(user));
    }

    /**
     * @notice Returns user balance in shares
     */
    function sharesOf(address user) public view returns (uint256) {
        return shares[user];
    }

    /**
     * @notice Returns amount of klay in staking and unstaking reserve
     */
    function totalSupply() public view override returns (uint256) {
        return totalStaking;
    }

    ///////////////////////////////////////////////////////////////////
    //     Internal Functions
    ///////////////////////////////////////////////////////////////////

    /**
     * @notice Transfers token ownership
     * @param from address of current token owner
     * @param to address of new token owner
     * @param amount amount of tokens to transfer
     * Emits a `Transfer` event
     */
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        _beforeTokenTransfer(from, to, amount);

        _transferShares(from, to, _getSharesByKlay(amount));
        emit Transfer(from, to, amount);

        _afterTokenTransfer(from, to, amount);
    }

    ///////////////////////////////////////////////////////////////////
    //     Private Functions
    ///////////////////////////////////////////////////////////////////

    /**
     * @notice Deposits klay for user provided
     * @param user user to deposit for
     * @param amount amount to deposit
     * Emits a `Transfer` event from zero address to user
     */
    function _stake(address user, uint256 amount) private {
        uint256 sharesToMint = _getSharesByKlay(amount);

        _mintShares(user, sharesToMint);
        totalStaking += amount;

        emit Transfer(address(0), user, amount);
    }

    /**
     * @notice Requests unstaking of staked tokens
     * @param amount amount to unstake
     * Emits a `Transfer` event from msgSender to zero address
     */
    function _unstake(uint256 amount) private {
        address user = _msgSender();

        uint256 sharesToBurn = _getSharesByKlay(amount);
        _burnShares(user, sharesToBurn);

        totalStaking -= amount;

        emit Transfer(user, address(0), amount);
    }

    /**
     * @notice Mints new shares of the token to a certain user
     * @param user address to mint shares to
     * @param amount amount to mint
     * Emits a `SharesChanged` event
     */
    function _mintShares(address user, uint256 amount) private {
        totalShares += amount;
        uint256 prevShares = sharesOf(user);
        shares[user] = prevShares + amount;
    }

    /**
     * @notice Burns shares of the token
     * @param user address to burn for
     * @param amount amount to burn
     */
    function _burnShares(address user, uint256 amount) private {
        uint256 prevShares = sharesOf(user);
        require(prevShares >= amount, "insufficient shares");

        totalShares -= amount;
        shares[user] = prevShares - amount;
    }

    /**
     * @notice Transfers shares from one address to another
     * @param from address to transfer from
     * @param to address to transfer to
     * @param amount amount to transfer
     */
    function _transferShares(
        address from,
        address to,
        uint256 amount
    ) private {
        uint256 fromShares = sharesOf(from);
        require(fromShares >= amount, "insufficient shares");

        shares[from] = fromShares - amount;
        uint256 toShares = sharesOf(to);
        shares[to] = toShares + amount;
    }

    /**
         * @notice Returns amount of fKlay for corresponding shares
     * @dev Shares --> Klay
     * @param sharesAmount amount of shares to convert
     */
    function _getKlayByShares(uint256 sharesAmount)
    private
    view
    returns (uint256)
    {
        return (sharesAmount * liquidityIndex) / 10**27;
    }

    /**
     * @notice Returns amount of shares for corresponding fKlay
     * @dev Klay --> Shares
     * @param klayAmount amount of fKlay to convert
     */
    function _getSharesByKlay(uint256 klayAmount)
    private
    view
    returns (uint256)
    {
        return (klayAmount * 10**27 + liquidityIndex - 1) / liquidityIndex;
    }
}
