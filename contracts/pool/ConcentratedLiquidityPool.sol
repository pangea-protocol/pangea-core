// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IMasterDeployer.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IPoolEventStruct.sol";
import "../interfaces/IPoolLogger.sol";
import "../interfaces/IPoolFlashCallback.sol";
import "../interfaces/IConcentratedLiquidityPool.sol";
import "../interfaces/LPAirdropCallee.sol";
import "../interfaces/IPoolFactoryCallee.sol";
import "../interfaces/IProtocolFeeReceiver.sol";
import "../libraries/FullMath.sol";
import "../libraries/TickMath.sol";
import "../libraries/UnsafeMath.sol";
import "../libraries/DyDxMath.sol";
import "../libraries/FeeLib.sol";
import "../libraries/Ticks.sol";
import "../libraries/FixedPoint.sol";

/// @notice Concentrated liquidity pool implementation.
/// @dev Based on Trident source code - Concentrated Liquidity Pool
contract ConcentratedLiquidityPool is IConcentratedLiquidityPoolStruct, IPoolFactoryCallee, LPAirdropCallee {
    using SafeERC20 for IERC20;
    using Ticks for mapping(int24 => Tick);

    /// @dev `protocolFee` is 10% of the total swap fee
    uint256 public constant protocolFee = 1000;

    /// @dev Reference: tickSpacing of 100 -> 1% between ticks.
    uint24 public immutable tickSpacing;

    /// @dev 1000 corresponds to 0.1% fee. Fee is measured in pips.
    uint24 public immutable swapFee;
    uint128 internal immutable MAX_TICK_LIQUIDITY;

    IMasterDeployer internal immutable masterDeployer;
    IPoolLogger internal logger;

    address public immutable token0;
    address public immutable token1;
    address public immutable factory;

    uint128 public liquidity;

    /// @dev Multiplied by 2^128.
    uint160 internal secondsGrowthGlobal;
    uint32 internal lastObservation;

    /// @dev swap fee growth counters are multiplied by 2 ^ 128.
    /// total fee (reward) = swap fee + airdrop
    ///  * swap Fee = Tokens accrued from swaps in the pool
    ///  * airdrop = Tokens provided to directly reward Liquidity Providers
    uint256 internal swapFeeGrowthGlobal0;
    uint256 internal swapFeeGrowthGlobal1;

    /// @dev airdrop fee growth counters are multiplied by 2 ^ 128.
    uint256 internal airdropGrowthGlobal0;
    uint256 internal airdropGrowthGlobal1;

    /// @dev airdrop Fee distribution Rate per second at current epoch, multiplied by 2 ^ 128
    uint256 public airdrop0PerSecond;
    uint256 public airdrop1PerSecond;

    uint256 public airdropStartTime;
    uint256 public airdropPeriod;

    uint128 internal token0ProtocolFee;
    uint128 internal token1ProtocolFee;

    uint128 internal reserve0;
    uint128 internal reserve1;

    /// @dev Sqrt of price aka. √(token1/token0), multiplied by 2 ^ 96.
    uint160 public price;
    /// @dev Tick that is just below the current price.
    int24 public nearestTick;

    uint256 internal unlocked;

    uint256 public totalTicks;
    mapping(int24 => Tick) public ticks;
    mapping(address => mapping(int24 => mapping(int24 => Position))) public positions;

    uint256 public immutable createdTime;
    uint256 public immutable createdBlockNumber;

    /// @dev Error list to optimize around pool requirements.
    error Locked();
    error ZeroAddress();
    error InvalidSwapFee();
    error LiquidityOverflow();
    error LiquidityZero();
    error LiquidityInsufficient();
    error Token0Missing();
    error Token1Missing();
    error InvalidTick();
    error InvalidParam();
    error LowerEven();
    error UpperOdd();
    error Overflow();
    error NotAuthorized();
    error AlreadyPriceInitialized();

    modifier lock() {
        if (unlocked == 2) revert Locked();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    /// @dev Only set immutable variables here - state changes made here will not be used.
    constructor(bytes memory _deployData, IMasterDeployer _masterDeployer) {
        (address _token0, address _token1, uint24 _swapFee, uint24 _tickSpacing) = abi.decode(
            _deployData,
            (address, address, uint24, uint24)
        );

        if (_token0 == address(0)) revert ZeroAddress();
        if (_token0 == _token1) revert InvalidParam();

        token0 = _token0;
        token1 = _token1;
        swapFee = _swapFee;
        tickSpacing = _tickSpacing;
        factory = msg.sender;
        masterDeployer = _masterDeployer;

        MAX_TICK_LIQUIDITY = Ticks.getMaxLiquidity(_tickSpacing);
        ticks[TickMath.MIN_TICK] = Tick(TickMath.MIN_TICK, TickMath.MAX_TICK, uint128(0), 0, 0, 0);
        ticks[TickMath.MAX_TICK] = Tick(TickMath.MIN_TICK, TickMath.MAX_TICK, uint128(0), 0, 0, 0);
        nearestTick = TickMath.MIN_TICK;
        unlocked = 1;
        lastObservation = uint32(block.timestamp);
        totalTicks = 2;

        createdTime = block.timestamp;
        createdBlockNumber = block.number;
    }

    /// @dev Price is not a constructor parameter to allow for predictable address calculation.
    function setPrice(uint160 _price) external {
        if (msg.sender != factory) revert NotAuthorized();
        if (price != 0) revert AlreadyPriceInitialized();
        TickMath.validatePrice(_price);
        price = _price;
    }

    /// @dev Called only once from the factory.
    function registerLogger(address _logger) external {
        if (msg.sender != factory) revert NotAuthorized();
        logger = IPoolLogger(_logger);
    }

    /// @dev Mints LP tokens - should be called via the CL pool manager contract.
    function mint(MintParams memory mintParams) external lock returns (uint256 liquidityMinted) {
        _ensureTickSpacing(mintParams.lower, mintParams.upper);

        uint256 priceLower = uint256(TickMath.getSqrtRatioAtTick(mintParams.lower));
        uint256 priceUpper = uint256(TickMath.getSqrtRatioAtTick(mintParams.upper));
        uint256 currentPrice = uint256(price);
        liquidityMinted = DyDxMath.getLiquidityForAmounts(
            priceLower,
            priceUpper,
            currentPrice,
            uint256(mintParams.amount1Desired),
            uint256(mintParams.amount0Desired)
        );

        // Ensure no overflow happens when we cast from uint256 to int128.
        if (liquidityMinted > uint128(type(int128).max)) revert Overflow();
        if (liquidityMinted == 0) revert LiquidityZero();

        _updateObservationRecord(uint256(liquidity));

        unchecked {
            _updatePosition(msg.sender, mintParams.lower, mintParams.upper, int128(uint128(liquidityMinted)));
            if (priceLower <= currentPrice && currentPrice < priceUpper) liquidity += uint128(liquidityMinted);
        }

        {
            uint256 numOfInserted;
            (nearestTick, numOfInserted) = Ticks.insert(
                ticks,
                swapFeeGrowthGlobal0 + airdropGrowthGlobal0,
                swapFeeGrowthGlobal1 + airdropGrowthGlobal1,
                secondsGrowthGlobal,
                mintParams.lowerOld,
                mintParams.lower,
                mintParams.upperOld,
                mintParams.upper,
                uint128(liquidityMinted),
                nearestTick,
                uint160(currentPrice)
            );
            totalTicks += numOfInserted;
        }

        (uint128 amount0Actual, uint128 amount1Actual) = DyDxMath.getAmountsForLiquidity(
            priceLower,
            priceUpper,
            currentPrice,
            liquidityMinted,
            true
        );

        IPositionManager(msg.sender).mintCallback(token0, token1, amount0Actual, amount1Actual);

        if (amount0Actual != 0) {
            reserve0 += amount0Actual;
            if (reserve0 > _balance(token0)) revert Token0Missing();
        }

        if (amount1Actual != 0) {
            reserve1 += amount1Actual;
            if (reserve1 > _balance(token1)) revert Token1Missing();
        }

        try
            logger.emitMint(
                IPoolEventStruct.LiquidityLoggingParams({
                    lower: mintParams.lower,
                    upper: mintParams.upper,
                    amount0: amount0Actual,
                    amount1: amount1Actual,
                    liquidity: liquidityMinted
                })
            )
        {} catch {}
    }

    function burn(
        int24 lower,
        int24 upper,
        uint128 amount
    ) external lock returns (uint256 token0Amount, uint256 token1Amount) {
        uint160 priceLower = TickMath.getSqrtRatioAtTick(lower);
        uint160 priceUpper = TickMath.getSqrtRatioAtTick(upper);
        uint160 currentPrice = price;

        _updateObservationRecord(uint256(liquidity));

        unchecked {
            if (priceLower <= currentPrice && currentPrice < priceUpper) liquidity -= amount;
        }

        (token0Amount, token1Amount) = DyDxMath.getAmountsForLiquidity(
            uint256(priceLower),
            uint256(priceUpper),
            uint256(currentPrice),
            uint256(amount),
            false
        );

        // Ensure no overflow happens when we cast from uint128 to int128.
        if (amount > uint128(type(int128).max)) revert Overflow();

        _updatePosition(msg.sender, lower, upper, -int128(amount));

        unchecked {
            reserve0 -= uint128(token0Amount);
            reserve1 -= uint128(token1Amount);
        }

        _transferBothTokens(msg.sender, token0Amount, token1Amount);

        {
            uint256 numOfRemoved;
            (nearestTick, numOfRemoved) = Ticks.remove(ticks, lower, upper, amount, nearestTick);
            totalTicks -= numOfRemoved;
        }

        try
            logger.emitBurn(
                IPoolEventStruct.LiquidityLoggingParams({
                    lower: lower,
                    upper: upper,
                    amount0: token0Amount,
                    amount1: token1Amount,
                    liquidity: uint256(amount)
                })
            )
        {} catch {}
    }

    function collect(
        int24 lower,
        int24 upper,
        uint256 desiredToken0Fees,
        uint256 desiredToken1Fees
    ) external lock returns (uint256 token0Fees, uint256 token1Fees) {
        _updatePosition(msg.sender, lower, upper, 0);
        (token0Fees, token1Fees) = _collectFromFeeOwed(msg.sender, lower, upper, desiredToken0Fees, desiredToken1Fees);

        reserve0 -= uint128(token0Fees);
        reserve1 -= uint128(token1Fees);

        _transferBothTokens(msg.sender, token0Fees, token1Fees);

        try logger.emitCollect(IPoolEventStruct.CollectLoggingParams({amount0: token0Fees, amount1: token1Fees})) {} catch {}
    }

    /// @dev Swaps one token for another. The router must prefund this contract and ensure there isn't too much slippage.
    function swap(bytes memory data) external lock returns (uint256 amountOut) {
        (bool zeroForOne, address recipient) = abi.decode(data, (bool, address));

        uint256 inAmount = _balance(zeroForOne ? token0 : token1) - (zeroForOne ? reserve0 : reserve1);

        SwapCache memory cache = SwapCache({
            feeAmount: 0,
            totalFeeAmount: 0,
            protocolFee: 0,
            swapFeeGrowthGlobalA: zeroForOne ? swapFeeGrowthGlobal1 : swapFeeGrowthGlobal0,
            swapFeeGrowthGlobalB: zeroForOne ? swapFeeGrowthGlobal0 : swapFeeGrowthGlobal1,
            currentPrice: uint256(price),
            currentLiquidity: uint256(liquidity),
            input: inAmount,
            nextTickToCross: zeroForOne ? nearestTick : ticks[nearestTick].nextTick
        });

        _ensureLiquidityForSwap(cache);

        _updateObservationRecord(cache.currentLiquidity);

        while (cache.input != 0) {
            uint256 nextTickPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
            uint256 output = 0;
            bool cross = false;

            if (zeroForOne) {
                // Trading token 0 (x) for token 1 (y).
                // Price is decreasing.
                // Maximum input amount within current tick range: Δx = Δ(1/√𝑃) · L.
                uint256 maxDx = DyDxMath.getDx(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false);

                if (cache.input <= maxDx) {
                    // We can swap within the current range.
                    uint256 liquidityPadded = cache.currentLiquidity << FixedPoint.Q96RES;
                    // Calculate new price after swap: √𝑃[new] =  L · √𝑃 / (L + Δx · √𝑃)
                    // This is derived from Δ(1/√𝑃) = Δx/L
                    // where Δ(1/√𝑃) is 1/√𝑃[old] - 1/√𝑃[new] and we solve for √𝑃[new].
                    // In case of an overflow we can use: √𝑃[new] = L / (L / √𝑃 + Δx).
                    // This is derived by dividing the original fraction by √𝑃 on both sides.
                    uint256 newPrice = uint256(
                        FullMath.mulDivRoundingUp(liquidityPadded, cache.currentPrice, liquidityPadded + cache.currentPrice * cache.input)
                    );

                    if (!(nextTickPrice <= newPrice && newPrice < cache.currentPrice)) {
                        // Overflow. We use a modified version of the formula.
                        newPrice = uint160(UnsafeMath.divRoundingUp(liquidityPadded, liquidityPadded / cache.currentPrice + cache.input));
                    }
                    // Based on the price difference calculate the output of th swap: Δy = Δ√P · L.
                    output = DyDxMath.getDy(cache.currentLiquidity, newPrice, cache.currentPrice, false);
                    cache.currentPrice = newPrice;
                    cache.input = 0;
                } else {
                    // Execute swap step and cross the tick.
                    output = DyDxMath.getDy(cache.currentLiquidity, nextTickPrice, cache.currentPrice, false);
                    cache.currentPrice = nextTickPrice;
                    cross = true;
                    cache.input -= maxDx;
                }
            } else {
                // Price is increasing.
                // Maximum swap amount within the current tick range: Δy = Δ√P · L.
                uint256 maxDy = DyDxMath.getDy(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false);

                if (cache.input <= maxDy) {
                    // We can swap within the current range.
                    // Calculate new price after swap: ΔP = Δy/L.
                    uint256 newPrice = cache.currentPrice + FullMath.mulDiv(cache.input, FixedPoint.Q96, cache.currentLiquidity);
                    // Calculate output of swap
                    // - Δx = Δ(1/√P) · L.
                    output = DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, newPrice, false);
                    cache.currentPrice = newPrice;
                    cache.input = 0;
                } else {
                    // Swap & cross the tick.
                    output = DyDxMath.getDx(cache.currentLiquidity, cache.currentPrice, nextTickPrice, false);
                    cache.currentPrice = nextTickPrice;
                    cross = true;
                    cache.input -= maxDy;
                }
            }

            // cache.feeGrowthGlobalA is the feeGrowthGlobal counter for the output token.
            // It increases each swap step.
            if (cache.currentLiquidity > 0) {
                (cache.totalFeeAmount, amountOut, cache.protocolFee, cache.swapFeeGrowthGlobalA) = FeeLib.handleSwapFee(
                    output,
                    swapFee,
                    protocolFee,
                    cache.currentLiquidity,
                    cache.totalFeeAmount,
                    amountOut,
                    cache.protocolFee,
                    cache.swapFeeGrowthGlobalA
                );
            }

            if (cross) {
                _cross(cache, zeroForOne);

                if (cache.currentLiquidity == 0) {
                    if (cache.nextTickToCross == TickMath.MIN_TICK || cache.nextTickToCross == TickMath.MAX_TICK) {
                        // In the case of the last tick, there is no next tick.
                        // price must be crossed because of rangeFeeGrowth
                        if (zeroForOne) {
                            cache.currentPrice = Math.max(cache.currentPrice - 1, TickMath.MIN_SQRT_RATIO);
                            cache.nextTickToCross = ticks[cache.nextTickToCross].previousTick;
                        } else {
                            cache.currentPrice = Math.min(cache.currentPrice + 1, TickMath.MAX_SQRT_RATIO - 1);
                            cache.nextTickToCross = ticks[cache.nextTickToCross].nextTick;
                        }
                        break;
                    }

                    // We step into a zone that has liquidity
                    cache.currentPrice = uint256(TickMath.getSqrtRatioAtTick(cache.nextTickToCross));
                    _cross(cache, zeroForOne);
                }
            }
        }

        price = uint160(cache.currentPrice);

        int24 newNearestTick = zeroForOne ? cache.nextTickToCross : ticks[cache.nextTickToCross].previousTick;

        if (nearestTick != newNearestTick) {
            nearestTick = newNearestTick;
            liquidity = uint128(cache.currentLiquidity);
        }

        _updateReserves(zeroForOne, uint128(inAmount), amountOut);

        _updateSwapFees(zeroForOne, cache.swapFeeGrowthGlobalA, uint128(cache.protocolFee));

        if (zeroForOne) {
            _transfer(token1, amountOut, recipient);
        } else {
            _transfer(token0, amountOut, recipient);
        }

        try
            logger.emitSwap(IPoolEventStruct.SwapLoggingParams({zeroForOne: zeroForOne, amountIn: inAmount, amountOut: amountOut}))
        {} catch {}
    }

    function _cross(SwapCache memory cache, bool zeroForOne) internal {
        (cache.currentLiquidity, cache.nextTickToCross) = Ticks.cross(
            ticks,
            cache.nextTickToCross,
            secondsGrowthGlobal,
            cache.currentLiquidity,
            zeroForOne ? cache.swapFeeGrowthGlobalA + airdropGrowthGlobal1 : cache.swapFeeGrowthGlobalA + airdropGrowthGlobal0,
            zeroForOne ? cache.swapFeeGrowthGlobalB + airdropGrowthGlobal0 : cache.swapFeeGrowthGlobalB + airdropGrowthGlobal1,
            zeroForOne,
            tickSpacing
        );
    }

    /// @notice Receive token0 or token1 and pay it back with fee
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external lock {
        uint256 _liquidity = liquidity;
        if (_liquidity == 0) revert LiquidityZero();

        uint256 balance0Before = reserve0;
        uint256 balance1Before = reserve1;

        _transferBothTokens(recipient, amount0, amount1);
        (uint256 flashFee0, uint256 flashFee1) = FeeLib.calculateFlashFee(amount0, amount1, swapFee);
        IPoolFlashCallback(msg.sender).flashCallback(flashFee0, flashFee1, data);

        uint256 paid0;
        uint256 paid1;
        {
            uint256 balance0After = _balance(token0);
            uint256 balance1After = _balance(token1);

            if (balance0Before + flashFee0 > balance0After) revert Token0Missing();
            if (balance1Before + flashFee1 > balance1After) revert Token1Missing();

            // update reserves info
            reserve0 = SafeCast.toUint128(balance0After);
            reserve1 = SafeCast.toUint128(balance1After);

            paid0 = balance0After - balance0Before;
            paid1 = balance1After - balance1Before;
        }

        uint256 _protocolFeeRate = protocolFee;

        if (paid0 > 0) {
            // update swap Fee & protocol Fee for token0
            uint128 delta0 = uint128(FullMath.mulDivRoundingUp(paid0, _protocolFeeRate, 1e4));
            token0ProtocolFee += delta0;
            swapFeeGrowthGlobal0 += FullMath.mulDiv(paid0 - delta0, FixedPoint.Q128, _liquidity);
        }

        if (paid1 > 0) {
            // update swap Fee & protocol Fee for token1
            uint128 delta1 = uint128(FullMath.mulDivRoundingUp(paid1, _protocolFeeRate, 1e4));
            token1ProtocolFee += delta1;
            swapFeeGrowthGlobal1 += FullMath.mulDiv(paid1 - delta1, FixedPoint.Q128, _liquidity);
        }

        try
            logger.emitFlash(
                IPoolEventStruct.FlashLoggingParams({sender: msg.sender, amount0: amount0, amount1: amount1, paid0: paid0, paid1: paid1})
            )
        {} catch {}
    }

    /// @dev Collects Protocol Fees
    function collectProtocolFee() external lock returns (uint128 amount0, uint128 amount1) {
        address _protocolFeeTo = masterDeployer.protocolFeeTo();
        address[] memory tokens = new address[](2);
        uint256[] memory amounts = new uint256[](2);

        if (token0ProtocolFee > 0) {
            amount0 = token0ProtocolFee;
            token0ProtocolFee = 0;
            reserve0 -= amount0;

            _transfer(token0, amount0, _protocolFeeTo);
            tokens[0] = token0;
            amounts[0] = amount0;
        }

        if (token1ProtocolFee > 0) {
            amount1 = token1ProtocolFee;
            token1ProtocolFee = 0;
            reserve1 -= amount1;

            _transfer(token1, amount1, _protocolFeeTo);
            tokens[1] = token1;
            amounts[1] = amount1;
        }

        if (_protocolFeeTo.code.length > 0) {
            // if protocolFee is contract, call callback
            IProtocolFeeReceiver(_protocolFeeTo).collectFeeCallback(tokens, amounts);
        }
        return (amount0, amount1);
    }

    /// @dev deposit Airdrop tokens. This Airdrop will be provided to the LP with the swap Fee for a given period
    /// @param airdrop0   amount of token0 to deposit
    /// @param airdrop1   amount of token1 to deposit
    /// @param startTime  Airdrop distribution start time
    /// @param period     Airdrop distribution period
    function depositAirdrop(
        uint128 airdrop0,
        uint128 airdrop1,
        uint256 startTime,
        uint256 period
    ) external lock {
        if (masterDeployer.airdropDistributor() != msg.sender) revert NotAuthorized();
        if (startTime + period <= block.timestamp) revert InvalidParam();

        // not allowed before the previous airdrop is ended
        uint256 _airdropStartTime = airdropStartTime;
        uint256 _airdropLastTime = _airdropStartTime + airdropPeriod;
        if (_airdropLastTime > startTime) revert InvalidParam();

        // pull airdrop Amount and update reserve amount
        if (airdrop0 > 0) {
            IERC20(token0).safeTransferFrom(msg.sender, address(this), airdrop0);
            reserve0 += airdrop0;
        }
        if (airdrop1 > 0) {
            IERC20(token1).safeTransferFrom(msg.sender, address(this), airdrop1);
            reserve1 += airdrop1;
        }

        // distribute previous epoch airdrop if exist
        if (airdropDurationAfterLastObservation() > 0) {
            // update Record & distribute airdrop
            _updateObservationRecord(liquidity);

            // if undistributed airdrop existed (liquidity == 0),
            // remained is added to the next epoch airdrop
            uint256 _lastObservation = lastObservation;
            if (_lastObservation < _airdropLastTime) {
                uint256 diff = _airdropLastTime - Math.max(_lastObservation, _airdropStartTime);

                airdrop0 += SafeCast.toUint128(FullMath.mulDiv(airdrop0PerSecond, diff, FixedPoint.Q128));
                airdrop1 += SafeCast.toUint128(FullMath.mulDiv(airdrop1PerSecond, diff, FixedPoint.Q128));
            }
        }

        if (airdrop0 == 0 && airdrop1 == 0) {
            // No airdrop in this epoch
            airdrop0PerSecond = 0;
            airdrop1PerSecond = 0;
            airdropStartTime = 0;
            airdropPeriod = 0;
        } else {
            // write airdrop Parameters
            airdrop0PerSecond = FullMath.mulDiv(airdrop0, FixedPoint.Q128, period);
            airdrop1PerSecond = FullMath.mulDiv(airdrop1, FixedPoint.Q128, period);
            airdropStartTime = startTime;
            airdropPeriod = period;
        }
    }

    function _ensureTickSpacing(int24 lower, int24 upper) internal view {
        if (lower % int24(tickSpacing) != 0) revert InvalidTick();
        if ((lower / int24(tickSpacing)) % 2 != 0) revert LowerEven();
        if (upper % int24(tickSpacing) != 0) revert InvalidTick();
        if ((upper / int24(tickSpacing)) % 2 == 0) revert UpperOdd();
    }

    function _ensureLiquidityForSwap(SwapCache memory cache) internal pure {
        if (cache.currentLiquidity > 0) {
            return;
        }

        if (cache.nextTickToCross == TickMath.MIN_TICK || cache.nextTickToCross == TickMath.MAX_TICK) {
            // if there is no liquidity and current price is on last tick, revert transaction
            revert LiquidityInsufficient();
        }
    }

    function _updateObservationRecord(uint256 currentLiquidity) internal {
        if (currentLiquidity == 0) return;

        uint256 _lastObservation = uint256(lastObservation);
        if (block.timestamp <= _lastObservation) return;

        _updateAirdropGrowthGlobal(currentLiquidity);

        unchecked {
            // Overflow in 2106. Don't do staking rewards in the year 2106.
            lastObservation = uint32(block.timestamp);
            secondsGrowthGlobal += uint160(((block.timestamp - _lastObservation) << FixedPoint.Q128RES) / currentLiquidity);
        }
    }

    function _updateAirdropGrowthGlobal(uint256 currentLiquidity) internal {
        (uint256 remain0, uint256 remain1) = airdropGrowthRemain(currentLiquidity);
        if (remain0 > 0) airdropGrowthGlobal0 += remain0;
        if (remain1 > 0) airdropGrowthGlobal1 += remain1;
    }

    function airdropGrowthRemain(uint256 _liquidity) internal view returns (uint256 remain0, uint256 remain1) {
        if (_liquidity == 0) return (0, 0);

        uint256 duration = airdropDurationAfterLastObservation();
        if (duration > 0) {
            unchecked {
                remain0 = FullMath.mulDiv(airdrop0PerSecond, duration, _liquidity);
                remain1 = FullMath.mulDiv(airdrop1PerSecond, duration, _liquidity);
            }
        } else {
            remain0 = 0;
            remain1 = 0;
        }
    }

    function _updateReserves(
        bool zeroForOne,
        uint128 inAmount,
        uint256 amountOut
    ) internal {
        if (zeroForOne) {
            uint256 balance0 = _balance(token0);
            uint128 newBalance = reserve0 + inAmount;
            if (uint256(newBalance) > balance0) revert Token0Missing();
            reserve0 = newBalance;
            unchecked {
                reserve1 -= uint128(amountOut);
            }
        } else {
            uint256 balance1 = _balance(token1);
            uint128 newBalance = reserve1 + inAmount;
            if (uint256(newBalance) > balance1) revert Token1Missing();
            reserve1 = newBalance;
            unchecked {
                reserve0 -= uint128(amountOut);
            }
        }
    }

    function _updateSwapFees(
        bool zeroForOne,
        uint256 swapFeeGrowthGlobal,
        uint128 _protocolFee
    ) internal {
        if (zeroForOne) {
            swapFeeGrowthGlobal1 = swapFeeGrowthGlobal;
            token1ProtocolFee += _protocolFee;
        } else {
            swapFeeGrowthGlobal0 = swapFeeGrowthGlobal;
            token0ProtocolFee += _protocolFee;
        }
    }

    function _updatePosition(
        address owner,
        int24 lower,
        int24 upper,
        int128 amount
    ) internal {
        Position storage position = positions[owner][lower][upper];

        (uint256 rangeFeeGrowth0, uint256 rangeFeeGrowth1) = rangeFeeGrowth(lower, upper);

        uint256 amount0Fees;
        if (rangeFeeGrowth0 > position.feeGrowthInside0Last) {
            amount0Fees = FullMath.mulDiv(rangeFeeGrowth0 - position.feeGrowthInside0Last, position.liquidity, FixedPoint.Q128);
        }

        uint256 amount1Fees;
        if (rangeFeeGrowth1 > position.feeGrowthInside1Last) {
            amount1Fees = FullMath.mulDiv(rangeFeeGrowth1 - position.feeGrowthInside1Last, position.liquidity, FixedPoint.Q128);
        }

        if (amount < 0) {
            position.liquidity -= uint128(-amount);
        }

        if (amount > 0) {
            position.liquidity += uint128(amount);
            // Prevents a global liquidity overflow in even if all ticks are initialised.
            if (position.liquidity > MAX_TICK_LIQUIDITY) revert LiquidityOverflow();
        }

        position.feeGrowthInside0Last = rangeFeeGrowth0;
        position.feeGrowthInside1Last = rangeFeeGrowth1;
        position.feeOwed0 += uint128(amount0Fees);
        position.feeOwed1 += uint128(amount1Fees);
    }

    function _collectFromFeeOwed(
        address owner,
        int24 lower,
        int24 upper,
        uint256 desiredToken0Fees,
        uint256 desiredToken1Fees
    ) internal returns (uint256 token0Amount, uint256 token1Amount) {
        Position storage position = positions[owner][lower][upper];
        {
            uint128 feeOwed0 = position.feeOwed0;
            uint128 token0Fees_ = desiredToken0Fees >= type(uint128).max ? feeOwed0 : uint128(desiredToken0Fees);
            token0Amount = token0Fees_ >= feeOwed0 ? feeOwed0 : token0Fees_;
        }

        {
            uint128 feeOwed1 = position.feeOwed1;
            uint128 token1Fees_ = desiredToken1Fees >= type(uint128).max ? feeOwed1 : uint128(desiredToken1Fees);
            token1Amount = token1Fees_ >= feeOwed1 ? feeOwed1 : token1Fees_;
        }

        position.feeOwed0 -= uint128(token0Amount);
        position.feeOwed1 -= uint128(token1Amount);
    }

    /// @dev This function is gas optimized to avoid a redundant extcodesize check in addition to the returndatasize check
    function _balance(address token) internal view returns (uint256 balance) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(IERC20.balanceOf.selector, address(this)));
        require(success && data.length >= 32);
        return abi.decode(data, (uint256));
    }

    function _transfer(
        address token,
        uint256 shares,
        address to
    ) internal {
        IERC20(token).safeTransfer(to, shares);
    }

    function _transferBothTokens(
        address to,
        uint256 shares0,
        uint256 shares1
    ) internal {
        _transfer(token0, shares0, to);
        _transfer(token1, shares1, to);
    }

    /// @dev Generic formula for fee growth inside a range: (globalGrowth - growthBelow - growthAbove)
    /// - available counters: global, outside u, outside v.

    ///                  u         ▼         v
    /// ----|----|-------|xxxxxxxxxxxxxxxxxxx|--------|--------- (global - feeGrowthOutside(u) - feeGrowthOutside(v))

    ///             ▼    u                   v
    /// ----|----|-------|xxxxxxxxxxxxxxxxxxx|--------|--------- (global - (global - feeGrowthOutside(u)) - feeGrowthOutside(v))

    ///                  u                   v    ▼
    /// ----|----|-------|xxxxxxxxxxxxxxxxxxx|--------|--------- (global - feeGrowthOutside(u) - (global - feeGrowthOutside(v)))

    /// @notice Calculates the total fee growth inside a range (per unit of liquidity).
    /// @dev Multiply `rangeFeeGrowth` delta by the provided liquidity to get accrued fees for some period.
    /// @dev if lowerTick or upperTick isn't initialized, rangeFeeGrowth is calculated incorrectly
    function rangeFeeGrowth(int24 lowerTick, int24 upperTick) public view returns (uint256 feeGrowthInside0, uint256 feeGrowthInside1) {
        int24 currentTick = TickMath.getTickAtSqrtRatio(price);

        Tick memory lower = ticks[lowerTick];
        Tick memory upper = ticks[upperTick];

        // Calculate fee growth below & above.
        uint256 _feeGrowthGlobal0;
        uint256 _feeGrowthGlobal1;
        {
            (uint256 remain0, uint256 remain1) = airdropGrowthRemain(liquidity);
            _feeGrowthGlobal0 = swapFeeGrowthGlobal0 + airdropGrowthGlobal0 + remain0;
            _feeGrowthGlobal1 = swapFeeGrowthGlobal1 + airdropGrowthGlobal1 + remain1;
        }

        uint256 feeGrowthBelow0;
        uint256 feeGrowthBelow1;
        uint256 feeGrowthAbove0;
        uint256 feeGrowthAbove1;
        if (lowerTick <= currentTick) {
            feeGrowthBelow0 = lower.feeGrowthOutside0;
            feeGrowthBelow1 = lower.feeGrowthOutside1;
        } else {
            feeGrowthBelow0 = _feeGrowthGlobal0 - lower.feeGrowthOutside0;
            feeGrowthBelow1 = _feeGrowthGlobal1 - lower.feeGrowthOutside1;
        }

        if (currentTick < upperTick) {
            feeGrowthAbove0 = upper.feeGrowthOutside0;
            feeGrowthAbove1 = upper.feeGrowthOutside1;
        } else {
            feeGrowthAbove0 = _feeGrowthGlobal0 - upper.feeGrowthOutside0;
            feeGrowthAbove1 = _feeGrowthGlobal1 - upper.feeGrowthOutside1;
        }

        feeGrowthInside0 = _feeGrowthGlobal0 - feeGrowthBelow0 - feeGrowthAbove0;
        feeGrowthInside1 = _feeGrowthGlobal1 - feeGrowthBelow1 - feeGrowthAbove1;
    }

    function getAssets() external view returns (address[] memory assets) {
        assets = new address[](2);
        assets[0] = token0;
        assets[1] = token1;
    }

    function getImmutables()
        external
        view
        returns (
            uint128 _MAX_TICK_LIQUIDITY,
            uint24 _tickSpacing,
            uint24 _swapFee,
            address _factory,
            address _masterDeployer,
            address _token0,
            address _token1
        )
    {
        _MAX_TICK_LIQUIDITY = MAX_TICK_LIQUIDITY;
        _tickSpacing = tickSpacing;
        _swapFee = swapFee;
        _factory = factory;
        _masterDeployer = address(masterDeployer);
        _token0 = token0;
        _token1 = token1;
    }

    /// @notice The total fee growth of token0 collected per unit of liquidity for the entire life of the pool
    function feeGrowthGlobal0() external view returns (uint256) {
        return _feeGrowthGlobal(swapFeeGrowthGlobal0, airdropGrowthGlobal0, airdrop0PerSecond);
    }

    /// @notice The total fee growth of token1 collected per unit of liquidity for the entire life of the pool
    function feeGrowthGlobal1() external view returns (uint256) {
        return _feeGrowthGlobal(swapFeeGrowthGlobal1, airdropGrowthGlobal1, airdrop1PerSecond);
    }

    function _feeGrowthGlobal(
        uint256 _swapFeeGrowthGlobal,
        uint256 _airdropGrowthGlobal,
        uint256 _airdropPerSecond
    ) internal view returns (uint256) {
        uint256 duration = airdropDurationAfterLastObservation();
        uint256 _liquidity = liquidity;
        if (duration > 0 && _liquidity > 0) {
            return _swapFeeGrowthGlobal + _airdropGrowthGlobal + FullMath.mulDiv(_airdropPerSecond, duration, _liquidity);
        } else {
            return _swapFeeGrowthGlobal + _airdropGrowthGlobal;
        }
    }

    function airdropDurationAfterLastObservation() internal view returns (uint256) {
        uint256 _airdropStartTime = airdropStartTime;
        if (_airdropStartTime >= block.timestamp) {
            // airdrop is not started
            return 0;
        }

        uint256 _lastObservation = lastObservation;
        uint256 _airdropEndTime = _airdropStartTime + airdropPeriod;
        if (_airdropEndTime <= _lastObservation) {
            // airdrop is ended
            return 0;
        }

        return Math.min(block.timestamp, _airdropEndTime) - Math.max(_lastObservation, _airdropStartTime);
    }

    function getPriceAndNearestTicks() external view returns (uint160 _price, int24 _nearestTick) {
        _price = price;
        _nearestTick = nearestTick;
    }

    function getTokenProtocolFees() external view returns (uint128 _token0ProtocolFee, uint128 _token1ProtocolFee) {
        _token0ProtocolFee = token0ProtocolFee;
        _token1ProtocolFee = token1ProtocolFee;
    }

    function getReserves() external view returns (uint128 _reserve0, uint128 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }

    function getSecondsGrowthAndLastObservation() external view returns (uint160 _secondsGrowthGlobal, uint32 _lastObservation) {
        _secondsGrowthGlobal = secondsGrowthGlobal;
        _lastObservation = lastObservation;
    }
}
