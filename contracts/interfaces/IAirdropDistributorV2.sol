// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IAirdropDistributorV2Event {
    event Deposit(address indexed pool, address token, uint256 amount, address depositor);

    event Airdrop(address indexed pool, address token, uint128 amount, uint256 startTime, uint256 period);
}

interface IAirdropDistributorV2Error {
    error NotExists();

    error NotAllowedToken();

    error NotYet();
}

interface IAirdropDistributorV2 is IAirdropDistributorV2Event, IAirdropDistributorV2Error {
    /// @notice Number of pools that have ever been deposited
    function airdropPoolLength() external view returns (uint256);

    /// @notice the address of airdrop pool
    function airdropPool(uint256 idx) external view returns (address);

    /// @notice current deposited airdrop information in the pool.
    function depositedAirdrop(address pool)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory amounts,
            uint256 startTime
        );

    /// @notice deposit klay to the pool. klay will be distributed to the next epoch
    /// @param pool the address of pangea pool to deposit
    /// @dev transaction will revert if the asset in the pool is not WKLAY
    function depositKlay(address pool) external payable;

    /// @notice deposit token to the pool. the token will be distributed to the next epoch
    /// @param pool the address of pangea pool to deposit
    /// @param token token address to deposit. it must be one of the pools' tokens.
    /// @param amount amount of token to deposit
    /// @dev Approval (token.approve(airdropDistributor, amount)) must be performed before transaction
    function depositToken(
        address pool,
        address token,
        uint128 amount
    ) external;

    /// @notice airdrop the deposited assets of pool
    /// @param pool the address of pangea pool
    function airdrop(address pool) external;

    /// @notice airdrop Batch Call
    /// @param pools list of the addresses of pangea pool
    function airdropList(address[] memory pools) external;
}
