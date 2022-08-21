// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "../libraries/TickMath.sol";
import "../libraries/FullMath.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

// Referenced from https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/NFTDescriptor.sol
library PositionDescriptionLib {
    using TickMath for int24;
    using Strings for uint256;

    uint256 constant sqrt10X128 = 1076067327063303206878105757264492625226;

    struct DecimalStringParams {
        // significant figures of decimal
        uint256 sigfigs;
        // length of decimal string
        uint8 bufferLength;
        // ending index for significant figures (funtion works backwards when copying sigfigs)
        uint8 sigfigIndex;
        // index of decimal place (0 if no decimal)
        uint8 decimalIndex;
        // start index for trailing/leading 0's for very small/large numbers
        uint8 zerosStartIndex;
        // end index for trailing/leading 0's for very small/large numbers
        uint8 zerosEndIndex;
        // true if decimal number is less than one
        bool isLessThanOne;
        // true if string should include "%"
        bool isPercent;
    }

    function tickToDecimalString(
        int24 tick,
        uint8 baseTokenDecimals,
        uint8 quoteTokenDecimals
    ) internal pure returns (string memory) {
        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick);
        return fixedPointToDecimalString(sqrtRatioX96, baseTokenDecimals, quoteTokenDecimals);
    }

    function amountToDecimalString(uint256 amount) internal pure returns (string memory) {
        if (amount >= 1_000_000 ether) {
            return string(abi.encodePacked(fixedPointToAmount(amount / 10_000 ether), "M"));
        } else if (amount >= 1_000 ether) {
            return string(abi.encodePacked(fixedPointToAmount(amount / 10 ether), "k"));
        } else if (amount >= 0.01 ether) {
            return string(abi.encodePacked(fixedPointToAmount(amount / 0.01 ether), ""));
        } else {
            return "&lt; 0.01";
        }
    }

    function fixedPointToAmount(uint256 amount) internal pure returns (string memory) {
        string memory a = (amount / 100).toString();

        uint256 remain = amount % 100;
        string memory b = remain > 10 ? (amount % 100).toString() : string(abi.encodePacked("0", remain.toString()));
        return string(abi.encodePacked(a, ".", b));
    }

    // @notice Returns string that includes first 5 significant figures of a decimal number
    // @param sqrtRatioX96 a sqrt price
    function fixedPointToDecimalString(
        uint160 sqrtRatioX96,
        uint8 baseTokenDecimals,
        uint8 quoteTokenDecimals
    ) internal pure returns (string memory) {
        uint256 adjustedSqrtRatioX96 = adjustForDecimalPrecision(sqrtRatioX96, baseTokenDecimals, quoteTokenDecimals);
        uint256 value = FullMath.mulDiv(adjustedSqrtRatioX96, adjustedSqrtRatioX96, 1 << 64);

        bool priceBelow1 = adjustedSqrtRatioX96 < 2**96;
        if (priceBelow1) {
            // 10 ** 43 is precision needed to retreive 5 sigfigs of smallest possible price + 1 for rounding
            value = FullMath.mulDiv(value, 10**44, 1 << 128);
        } else {
            // leave precision for 4 decimal places + 1 place for rounding
            value = FullMath.mulDiv(value, 10**5, 1 << 128);
        }

        // get digit count
        uint256 temp = value;
        uint8 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        // don't count extra digit kept for rounding
        digits = digits - 1;

        // address rounding
        (uint256 sigfigs, bool extraDigit) = sigfigsRounded(value, digits);
        if (extraDigit) {
            digits++;
        }

        DecimalStringParams memory params;
        if (priceBelow1) {
            // 7 bytes ( "0." and 5 sigfigs) + leading 0's bytes
            params.bufferLength = uint8(uint8(7) + (uint8(43) - digits));
            params.zerosStartIndex = 2;
            params.zerosEndIndex = uint8(uint256(43) - digits + 1);
            params.sigfigIndex = uint8(params.bufferLength - 1);
        } else if (digits >= 9) {
            // no decimal in price string
            params.bufferLength = uint8(digits - 4);
            params.zerosStartIndex = 5;
            params.zerosEndIndex = uint8(params.bufferLength - 1);
            params.sigfigIndex = 4;
        } else {
            // 5 sigfigs surround decimal
            params.bufferLength = 6;
            params.sigfigIndex = 5;
            params.decimalIndex = uint8(digits - 4);
        }
        params.sigfigs = sigfigs;
        params.isLessThanOne = priceBelow1;
        params.isPercent = false;

        return generateDecimalString(params);
    }

    function sigfigsRounded(uint256 value, uint8 digits) private pure returns (uint256, bool) {
        bool extraDigit;
        if (digits > 5) {
            value = value / (10**(digits - 5));
        }
        bool roundUp = value % 10 > 4;
        value = value / 10;
        if (roundUp) {
            value = value + 1;
        }
        // 99999 -> 100000 gives an extra sigfig
        if (value == 100000) {
            value /= 10;
            extraDigit = true;
        }
        return (value, extraDigit);
    }

    function adjustForDecimalPrecision(
        uint160 sqrtRatioX96,
        uint8 baseTokenDecimals,
        uint8 quoteTokenDecimals
    ) private pure returns (uint256 adjustedSqrtRatioX96) {
        uint256 difference = abs(int256(uint256(baseTokenDecimals)) - int256(uint256(quoteTokenDecimals)));
        if (difference > 0 && difference <= 18) {
            if (baseTokenDecimals > quoteTokenDecimals) {
                adjustedSqrtRatioX96 = sqrtRatioX96 * 10**(difference / 2);
                if (difference % 2 == 1) {
                    adjustedSqrtRatioX96 = FullMath.mulDiv(adjustedSqrtRatioX96, sqrt10X128, 1 << 128);
                }
            } else {
                adjustedSqrtRatioX96 = sqrtRatioX96 / 10**(difference / 2);
                if (difference % 2 == 1) {
                    adjustedSqrtRatioX96 = FullMath.mulDiv(adjustedSqrtRatioX96, 1 << 128, sqrt10X128);
                }
            }
        } else {
            adjustedSqrtRatioX96 = uint256(sqrtRatioX96);
        }
    }

    function abs(int256 x) private pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }

    function generateDecimalString(DecimalStringParams memory params) private pure returns (string memory) {
        bytes memory buffer = new bytes(params.bufferLength);
        if (params.isPercent) {
            buffer[buffer.length - 1] = "%";
        }
        if (params.isLessThanOne) {
            buffer[0] = "0";
            buffer[1] = ".";
        }

        // add leading/trailing 0's
        for (uint256 zerosCursor = params.zerosStartIndex; zerosCursor < params.zerosEndIndex + 1; zerosCursor++) {
            buffer[zerosCursor] = bytes1(uint8(48));
        }

        // add sigfigs
        while (params.sigfigs > 0) {
            if (params.decimalIndex > 0 && params.sigfigIndex == params.decimalIndex) {
                buffer[params.sigfigIndex--] = ".";
            }
            if (params.sigfigIndex == 0) {
                buffer[0] = bytes1(uint8(uint256(48) + (params.sigfigs % 10)));
                break;
            } else {
                buffer[params.sigfigIndex--] = bytes1(uint8(uint256(48) + (params.sigfigs % 10)));
                params.sigfigs /= 10;
            }
        }
        return string(buffer);
    }

    function feeToPercentString(uint24 fee) internal pure returns (string memory) {
        if (fee == 0) {
            return "0%";
        }
        uint24 temp = fee;
        uint256 digits;
        uint8 numSigfigs;
        while (temp != 0) {
            if (numSigfigs > 0) {
                // count all digits preceding least significant figure
                numSigfigs++;
            } else if (temp % 10 != 0) {
                numSigfigs++;
            }
            digits++;
            temp /= 10;
        }

        DecimalStringParams memory params;
        uint256 nZeros;
        if (digits >= 5) {
            // if decimal > 1 (5th digit is the ones place)
            uint256 decimalPlace = (digits - numSigfigs) >= 4 ? 0 : 1;
            nZeros = (digits - 5) < (numSigfigs - 1) ? 0 : digits - 5 - (numSigfigs - 1);
            params.zerosStartIndex = numSigfigs;
            params.zerosEndIndex = uint8(params.zerosStartIndex + nZeros - 1);
            params.sigfigIndex = uint8(params.zerosStartIndex - 1 + decimalPlace);
            params.bufferLength = uint8(nZeros + numSigfigs + 1 + decimalPlace);
        } else {
            // else if decimal < 1
            nZeros = 5 - digits;
            params.zerosStartIndex = 2;
            params.zerosEndIndex = uint8(nZeros + params.zerosStartIndex - 1);
            params.bufferLength = uint8(nZeros + numSigfigs + 2);
            params.sigfigIndex = uint8(params.bufferLength - 2);
            params.isLessThanOne = true;
        }
        params.sigfigs = uint256(fee) / (10**(digits - numSigfigs));
        params.isPercent = true;
        params.decimalIndex = digits > 4 ? uint8(digits - 4) : 0;

        return generateDecimalString(params);
    }
}
