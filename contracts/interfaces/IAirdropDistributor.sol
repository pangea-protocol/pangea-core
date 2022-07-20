// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

interface IAirdropDistributorEvent {
    event Deposit(address indexed pool, address token, uint256 amount, address depositor);

    event Airdrop(
        address indexed pool,
        address token0,
        address token1,
        uint128 amount0,
        uint128 amount1,
        uint256 startTime,
        uint256 period
    );
}

interface IAirdropDistributorError {
    error NotExists();

    error NotPoolToken();

    error NotYet();

    error NotLPAirdropDistributor();

    error Overflow();
}

interface IAirdropDistributorStruct {
    struct AirdropInfo {
        /// @dev the airdrop amount of `token0` for the pool
        uint256 amount0;
        /// @dev the airdrop amount of `token1` for the pool
        uint256 amount1;
        /// @dev start time to distribute airdrop
        uint256 startTime;
    }
}

interface IAirdropDistributor is IAirdropDistributorEvent, IAirdropDistributorStruct, IAirdropDistributorError {
    /// @notice Number of pools that have ever been deposited
    function airdropPoolLength() external view returns (uint256);

    /// @notice record of past airdrop information distributed
    function airdropSnapshot(address pool, uint256 idx) external view returns (AirdropInfo memory snapshot);

    /// @notice Number of airdrop action distributed to the pool
    function airdropSnapshotLength(address pool) external view returns (uint256 length);

    /// @notice current deposited airdrop information in the pool. amount0 & amount1 will be zero after airdrop allocation
    function depositedAirdrop(address pool) external view returns (AirdropInfo memory);

    /// @notice the address of airdrop pool
    function airdropPool(uint256 idx) external view returns (address);

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
}
