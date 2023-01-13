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

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../../interfaces/IWETH.sol";
import "../../interfaces/IConcentratedLiquidityPool.sol";
import "../../interfaces/IPositionManager.sol";
import "../../interfaces/IMasterDeployer.sol";
import "../../libraries/FullMath.sol";
import "../../libraries/TickMath.sol";
import "../../libraries/DyDxMath.sol";
import "../../libraries/FixedPoint.sol";
import "../../abstract/PangeaBatchable.sol";
import "../../abstract/PangeaERC721.sol";
import "./interfaces/IMiningPoolManagerStruct.sol";
import "./interfaces/IMiningPoolManagerEvent.sol";
import "./interfaces/IMiningPoolStruct.sol";
import "./interfaces/IMiningPool.sol";
import "../../libraries/TickIndex.sol";

/// @notice Concentrated Liquidity Pool periphery contract that combines non-fungible position management
contract MiningPoolManager is
    IMiningPoolManagerStruct,
    IMiningPoolManagerEvent,
    IPositionManager,
    PangeaERC721,
    PangeaBatchable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using TickIndex for IMiningPool;

    address internal cachedMsgSender = address(1);
    address internal cachedPool = address(1);
    uint256 internal cachedAmount0 = 0;
    uint256 internal cachedAmount1 = 0;
    bool internal cachedNative = false;

    /// @notice ERC-20 token for wrapped KLAY (v10).
    address internal wETH;
    IMasterDeployer public masterDeployer;

    /// @notice the position information associated with a given token ID.
    mapping(uint256 => Position) public positions;
    mapping(uint256 => PositionReward) public positionRewards;

    error InvalidPool();
    error NotNativePool();
    error UnAuthorizedCallback();
    error TooLittleReceived();
    error PoolMisMatch();
    error RangeMisMatch();
    error NotAllowed();

    function initialize(address _masterDeployer, address _wETH) external initializer {
        __pangeaNFT_init();
        __ReentrancyGuard_init();

        masterDeployer = IMasterDeployer(_masterDeployer);
        descriptor = INFTDescriptor(msg.sender);
        wETH = _wETH;
        mint(address(this));
    }

    /// @notice set NFT Descriptor for tokenURI
    function setDescriptor(address _descriptor) external {
        if (msg.sender != address(descriptor)) revert NotAllowed();
        descriptor = INFTDescriptor(_descriptor);
    }

    modifier validPool(address pool) {
        if (!masterDeployer.pools(pool)) revert InvalidPool();
        _;
    }

    /// @notice Create or add additional Liquidity to a given position of ERC20-ERC20 pair pool
    /// @param pool           target pool
    /// @param lowerOld       previous lower tick
    /// @param lower          The lower end of the tick range for the position
    /// @param upperOld       previous upper tick
    /// @param upper          The upper end of the tick range for the position
    /// @param amount0Desired The amount of token0 to mint the given amount of liquidity
    /// @param amount1Desired The amount of token1 to mint the given amount of liquidity
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
    ) external nonReentrant validPool(pool) returns (uint256 _positionId) {
        _cacheForCallback(pool, amount0Desired, amount1Desired, false);
        return _mint(IMiningPool(pool), lowerOld, lower, upperOld, upper, amount0Desired, amount1Desired, minLiquidity, positionId);
    }

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
    ) external payable nonReentrant validPool(pool) returns (uint256 _positionId) {
        IMiningPool _pool = IMiningPool(pool);
        if (_pool.token0() == wETH) {
            _cacheForCallback(pool, msg.value, amountDesired, true);

            return _mint(_pool, lowerOld, lower, upperOld, upper, uint128(msg.value), amountDesired, minLiquidity, positionId);
        } else {
            if (_pool.token1() != wETH) revert NotNativePool();
            _cacheForCallback(pool, amountDesired, msg.value, true);
            return _mint(_pool, lowerOld, lower, upperOld, upper, amountDesired, uint128(msg.value), minLiquidity, positionId);
        }
    }

    function mintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) external {
        if (msg.sender != cachedPool) revert UnAuthorizedCallback();

        if (cachedNative && token0 == wETH) {
            _depositAndTransfer(msg.sender, amount0);
            safeTransferETH(cachedMsgSender, cachedAmount0 - amount0);
        } else {
            _transferTokenFrom(token0, cachedMsgSender, msg.sender, amount0);
        }

        if (cachedNative && token1 == wETH) {
            _depositAndTransfer(msg.sender, amount1);
            safeTransferETH(cachedMsgSender, cachedAmount1 - amount1);
        } else {
            _transferTokenFrom(token1, cachedMsgSender, msg.sender, amount1);
        }

        _resetCache();
    }

    function _cacheForCallback(
        address pool,
        uint256 amount0,
        uint256 amount1,
        bool native
    ) internal {
        cachedMsgSender = msg.sender;
        cachedPool = pool;
        cachedAmount0 = amount0;
        cachedAmount1 = amount1;
        cachedNative = native;
    }

    function _resetCache() internal {
        cachedMsgSender = address(1);
        cachedPool = address(1);
        cachedAmount0 = 0;
        cachedAmount1 = 0;
        cachedNative = false;
    }

    function _mint(
        IMiningPool pool,
        int24 lowerOld,
        int24 lower,
        int24 upperOld,
        int24 upper,
        uint128 amount0Desired,
        uint128 amount1Desired,
        uint256 minLiquidity,
        uint256 positionId
    ) internal returns (uint256 _positionId) {
        (lowerOld, lower, upperOld, upper) = pool.adjust(lowerOld, lower, upperOld, upper);

        uint128 liquidityMinted = uint128(
            pool.mint(
                IConcentratedLiquidityPoolStruct.MintParams({
                    lowerOld: lowerOld,
                    lower: lower,
                    upperOld: upperOld,
                    upper: upper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired
                })
            )
        );
        if (liquidityMinted < minLiquidity) revert TooLittleReceived();

        if (positionId == 0) {
            // We mint a new NFT.
            _positionId = nftCount.minted;
            (uint256 feeGrowthInside0, uint256 feeGrowthInside1) = pool.rangeFeeGrowth(lower, upper);
            positions[_positionId] = Position({
                pool: address(pool),
                liquidity: liquidityMinted,
                lower: lower,
                upper: upper,
                latestAddition: uint32(block.timestamp),
                feeGrowthInside0: feeGrowthInside0,
                feeGrowthInside1: feeGrowthInside1,
                feeOwed0: 0,
                feeOwed1: 0
            });
            positionRewards[_positionId] = PositionReward({rewardGrowthInside: pool.rangeRewardGrowth(lower, upper), rewardOwed: 0});
            mint(msg.sender);
        } else {
            // We increase liquidity for an existing NFT.
            _positionId = positionId;

            Position storage position = positions[_positionId];
            if (address(position.pool) != address(pool)) revert PoolMisMatch();
            if (position.lower != lower || position.upper != upper) revert RangeMisMatch();
            if (!_isApprovedOrOwner(msg.sender, _positionId)) revert NotAllowed();

            _settleFee(_positionId);
            _settleReward(_positionId);

            position.liquidity += liquidityMinted;
            // Incentives should be claimed first.
            position.latestAddition = uint32(block.timestamp);
        }

        {
            Position memory position = positions[_positionId];
            (uint128 amount0Actual, uint128 amount1Actual) = DyDxMath.getAmountsForLiquidity(
                TickMath.getSqrtRatioAtTick(position.lower),
                TickMath.getSqrtRatioAtTick(position.upper),
                IMiningPool(position.pool).price(),
                liquidityMinted,
                true
            );
            emit IncreaseLiquidity(address(pool), msg.sender, _positionId, amount0Actual, amount1Actual, liquidityMinted);
        }
    }

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
    ) external nonReentrant returns (uint256 token0Amount, uint256 token1Amount) {
        if (!_isApprovedOrOwner(msg.sender, positionId)) revert NotAllowed();

        Position memory position = positions[positionId];
        _settleFee(positionId);
        _settleReward(positionId);

        if (amount < position.liquidity) {
            (token0Amount, token1Amount) = IMiningPool(position.pool).burn(position.lower, position.upper, amount);
            positions[positionId].liquidity -= amount;
        } else {
            amount = position.liquidity;
            (token0Amount, token1Amount) = IMiningPool(position.pool).burn(position.lower, position.upper, amount);
            // if user burn all liquidity, collect fee first
            // slither-disable-next-line reentrancy-eth
            _collect(positionId, recipient, unwrap);
            // slither-disable-next-line reentrancy-eth
            _collectReward(positionId, recipient, unwrap);
            burn(positionId);
            delete positions[positionId];
        }
        if (token0Amount < minimumOut0 || token1Amount < minimumOut1) revert TooLittleReceived();

        _transferBoth(position.pool, recipient, token0Amount, token1Amount, unwrap);

        emit DecreaseLiquidity(address(position.pool), msg.sender, positionId, token0Amount, token1Amount, amount);
    }

    /// @notice Collects up to a maximum amount of fees owed to a specific position to the recipient
    /// @param positionId   The ID of the NFT for which tokens are being collected
    /// @param recipient    The account that should receive the tokens
    /// @param unwrap       unwrap or not if native token exists
    function collect(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external nonReentrant returns (uint256 token0Amount, uint256 token1Amount) {
        if (!_isApprovedOrOwner(msg.sender, positionId)) revert NotAllowed();
        _settleFee(positionId);
        return _collect(positionId, recipient, unwrap);
    }

    function collectReward(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) external nonReentrant returns (uint256 rewardAmount) {
        if (!_isApprovedOrOwner(msg.sender, positionId)) revert NotAllowed();
        _settleReward(positionId);
        return _collectReward(positionId, recipient, unwrap);
    }

    function _settleFee(uint256 positionId) internal {
        (uint256 allocatedFee0, uint256 allocatedFee1, uint256 feeGrowthInside0, uint256 feeGrowthInside1) = positionFees(positionId);

        Position storage position = positions[positionId];
        position.feeOwed0 = allocatedFee0;
        position.feeOwed1 = allocatedFee1;
        position.feeGrowthInside0 = feeGrowthInside0;
        position.feeGrowthInside1 = feeGrowthInside1;
    }

    function _settleReward(uint256 positionId) internal {
        (uint256 allocatedReward, uint256 rewardGrowthInside) = positionRewardAmount(positionId);

        PositionReward storage positionReward = positionRewards[positionId];
        positionReward.rewardOwed = allocatedReward;
        positionReward.rewardGrowthInside = rewardGrowthInside;
    }

    function _collect(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) internal returns (uint256 token0amount, uint256 token1amount) {
        Position storage position = positions[positionId];
        (token0amount, token1amount) = IMiningPool(position.pool).collect(
            position.lower,
            position.upper,
            position.feeOwed0,
            position.feeOwed1
        );
        position.feeOwed0 = 0;
        position.feeOwed1 = 0;

        _transferBoth(position.pool, recipient, token0amount, token1amount, unwrap);
        emit CollectFee(position.pool, recipient, positionId, token0amount, token1amount);
    }

    function _collectReward(
        uint256 positionId,
        address recipient,
        bool unwrap
    ) internal returns (uint256 rewardAmount) {
        Position storage position = positions[positionId];
        rewardAmount = IMiningPool(position.pool).collectReward(position.lower, position.upper, positionRewards[positionId].rewardOwed);
        positionRewards[positionId].rewardOwed = 0;

        address rewardToken = IMiningPool(position.pool).rewardToken();
        if (unwrap && rewardToken == wETH) {
            _transferOutETH(recipient, rewardAmount);
        } else if (rewardToken == address(0)) {} else {
            _transferToken(rewardToken, recipient, rewardAmount);
        }
        emit CollectReward(position.pool, recipient, positionId, rewardAmount);
    }

    /// @notice Returns the claimable fees and the fee growth accumulators of a given position
    function positionFees(uint256 positionId)
        public
        view
        returns (
            uint256 token0amount,
            uint256 token1amount,
            uint256 feeGrowthInside0,
            uint256 feeGrowthInside1
        )
    {
        Position memory position = positions[positionId];

        (feeGrowthInside0, feeGrowthInside1) = IMiningPool(position.pool).rangeFeeGrowth(position.lower, position.upper);
        unchecked {
            // @dev underflow is intended.
            token0amount =
                FullMath.mulDiv(feeGrowthInside0 - position.feeGrowthInside0, position.liquidity, FixedPoint.Q128) +
                position.feeOwed0;
            token1amount =
                FullMath.mulDiv(feeGrowthInside1 - position.feeGrowthInside1, position.liquidity, FixedPoint.Q128) +
                position.feeOwed1;
        }
    }

    function positionRewardAmount(uint256 positionId) public view returns (uint256 rewardAmount, uint256 rewardGrowthInside) {
        Position memory position = positions[positionId];
        PositionReward memory positionReward = positionRewards[positionId];

        rewardGrowthInside = IMiningPool(position.pool).rangeRewardGrowth(position.lower, position.upper);
        unchecked {
            // @dev underflow is intended.
            rewardAmount =
                FullMath.mulDiv(rewardGrowthInside - positionReward.rewardGrowthInside, position.liquidity, FixedPoint.Q128) +
                positionReward.rewardOwed;
        }
    }

    function _transferBoth(
        address pool,
        address to,
        uint256 token0Amount,
        uint256 token1Amount,
        bool unwrap
    ) internal {
        address token0 = IMiningPool(pool).token0();
        if (token0 == wETH && unwrap) {
            _transferOutETH(to, token0Amount);
        } else {
            _transferToken(token0, to, token0Amount);
        }

        address token1 = IMiningPool(pool).token1();
        if (token1 == wETH && unwrap) {
            _transferOutETH(to, token1Amount);
        } else {
            _transferToken(token1, to, token1Amount);
        }
    }

    function _depositAndTransfer(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        // slither-disable-next-line arbitrary-send
        IWETH(wETH).depositTo{value: amount}(recipient);
    }

    function _transferToken(
        address token,
        address to,
        uint256 amount
    ) internal {
        // slither-disable-next-line reentrancy-eth
        IERC20(token).safeTransfer(to, amount);
    }

    function _transferTokenFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    function _transferOutETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        IWETH(wETH).withdrawTo(payable(to), amount);
    }

    function safeTransferETH(address recipient, uint256 amount) internal {
        // slither-disable-next-line arbitrary-send
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH_TRANSFER_FAILED");
    }
}
