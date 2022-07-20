// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "./IConcentratedLiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

/// @notice concentrated liquidity pool manager contract Structs.
interface IConcentratedLiquidityPoolManagerStruct {
    struct Position {
        address pool; /// @dev the pool address
        uint128 liquidity; /// @dev The amount of liquidity for this position
        int24 lower; /// @dev The lower end of the tick range for the position
        int24 upper; /// @dev The upper end of the tick range for the position
        uint32 latestAddition; /// @dev useless field, but reserved for the future
        uint256 feeGrowthInside0; /// @dev The fee growth of token0 as of the last action on the individual position
        uint256 feeGrowthInside1; /// @dev The fee growth of token0 as of the last action on the individual position
        uint256 feeOwed0; /// @dev The amount of token0 owed to the position as of the last computation
        uint256 feeOwed1; /// @dev The amount of token1 owed to the position as of the last computation
    }

    struct MintParam {
        address pool;
        int24 lowerOld;
        int24 lower;
        int24 upperOld;
        int24 upper;
        uint128 amount0Desired;
        uint128 amount1Desired;
        uint256 minLiquidity;
        uint256 positionId;
    }

    struct MintNativeParam {
        address pool;
        int24 lowerOld;
        int24 lower;
        int24 upperOld;
        int24 upper;
        uint128 amountDesired;
        uint256 minLiquidity;
        uint256 positionId;
    }
}

interface IConcentratedLiquidityPoolManagerEvent {
    event IncreaseLiquidity(address indexed pool, address indexed owner, uint256 indexed positionId, uint256 amount0, uint256 amount1, uint128 liquidity);

    event DecreaseLiquidity(address indexed pool, address indexed owner, uint256 indexed positionId, uint256 amount0, uint256 amount1, uint128 liquidity);

    event CollectFee(address indexed pool, address indexed recipient, uint256 indexed positionId, uint256 amount0, uint256 amount1);
}

/// @notice concentrated liquidity manager contract interface.
interface IConcentratedLiquidityPoolManager is
    IConcentratedLiquidityPoolManagerStruct,
    IConcentratedLiquidityPoolManagerEvent,
    IERC721Enumerable
{
    /// @dev return the position information associated with a given token ID.
    function positions(uint256 positionId) external view returns (Position memory);

    /// @dev Create or add additional Liquidity to a given position of ERC20-ERC20 pair pool
    /// @param pool           target pool
    /// @param lowerOld       previous lower tick
    /// @param lower          The lower end of the tick range for the position
    /// @param upperOld       previous upper tick
    /// @param upper          The upper end of the tick range for the position
    /// @param amount0Desired The amount of token0
    /// @param amount1Desired The amount of token1
    /// @param minLiquidity   minimum liquidity to create
    /// @param positionId     create position if position = 0, else add additional liquidity
    function mint(
        address pool,
        int24 lowerOld,
        int24 lower,
        int24 upperOld,
        int24 upper,
        uint128 amount0Desired,
        uint128 amount1Desired,
        uint256 minLiquidity,
        uint256 positionId
    ) external returns (uint256);

    /// @notice Create or add additional Liquidity to a given position of ERC20-NATIVE pair pool
    /// @param pool           target pool
    /// @param lowerOld       previous lower tick
    /// @param lower          The lower end of the tick range for the position
    /// @param upperOld       previous upper tick
    /// @param upper          The upper end of the tick range for the position
    /// @param amountDesired  The amount of token
    /// @param minLiquidity   minimum liquidity to create (slippage)
    /// @param positionId     create position if position = 0, else add additional liquidity
    function mintNative(
        address pool,
        int24 lowerOld,
        int24 lower,
        int24 upperOld,
        int24 upper,
        uint128 amountDesired,
        uint256 minLiquidity,
        uint256 positionId
    ) external payable returns (uint256);

    /// @notice burn liquidity ( if burn all liquidity, delete tokenId )
    /// @param positionId     The ID of the NFT
    /// @param amount         the amount by which liquidity will be burned
    /// @param recipient      The account that should receive the tokens
    /// @param minimumOut0    The minimum amount of token0 that should be accounted for the burned liquidity
    /// @param minimumOut1    The minimum amount of token1 that should be accounted for the burned liquidity
    /// @param unwrap         unwrap or not if native token exists
    function burn(
        uint256 positionId,
        uint128 amount,
        address recipient,
        uint256 minimumOut0,
        uint256 minimumOut1,
        bool unwrap
    ) external returns (uint256 token0Amount, uint256 token1Amount);

    /// @notice Returns the claimable fees and the fee growth accumulators of a given position
    function positionFees(uint256 positionId)
        external
        view
        returns (
            uint256 token0amount,
            uint256 token1amount,
            uint256 feeGrowthInside0,
            uint256 feeGrowthInside1
        );

    /// @notice Collects up to a maximum amount of fees owed to a specific position to the recipient
    /// @param positionId   The ID of the NFT for which tokens are being collected
    /// @param recipient    The account that should receive the tokens
    /// @param unwrap       unwrap or not if native token exists
    function collect(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external returns (uint256 token0amount, uint256 token1amount);
}
