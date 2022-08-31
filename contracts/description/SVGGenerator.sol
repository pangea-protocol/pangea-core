// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./PositionDescriptionLib.sol";
import "../libraries/TickMath.sol";
import "./resources/OffPosition.sol";
import "./resources/OnPosition.sol";
import "./resources/Message.sol";
import "./resources/Font.sol";
import "./resources/BiArrow.sol";

library SVGGenerator {
    string internal constant CANVAS =
        '<svg xmlns="http://www.w3.org/2000/svg" width="264" height="264" version="1.1" font-family="volcano" fill="#ffffff">';
    string internal constant FOOTER = '<rect x="0" y="232" width="264" height="32"  fill="#000000"/>';
    string internal constant END = "</svg>";

    bytes32 internal constant WKLAY10_HASH = keccak256(abi.encode("WKLAY10"));
    bytes32 internal constant WKLAY_HASH = keccak256(abi.encode("WKLAY"));

    /// parameter
    struct PosParam {
        address token0;
        address token1;
        uint24 fee;
        uint160 curr;
        int24 lower;
        int24 upper;
    }

    function positionSVG(PosParam memory param) internal view returns (string memory) {
        string memory _token0Text = token0Text(param.token0);
        string memory _token1Text = token1Text(param.token1);
        string memory _feeText = feeText(param.fee);
        string memory _priceText = priceRangeText(param);
        bool _inRange = inRange(param.curr, param.lower, param.upper);
        string memory background = _inRange ? OnPosition.IMAGE() : OffPosition.IMAGE();
        return string(abi.encodePacked(SVGImage(background), _token0Text, _token1Text, _feeText, _priceText, END));
    }

    function SVGImage(string memory innerImage) internal pure returns (string memory) {
        return string(abi.encodePacked(CANVAS, innerImage, Font.RESOURCE(), FOOTER, Message.IMAGE()));
    }

    function priceText(
        int24 lower,
        address token0,
        address token1
    ) internal view returns (string memory) {
        uint8 token0Decimal = IERC20Metadata(token0).decimals();
        uint8 token1Decimal = IERC20Metadata(token1).decimals();
        return PositionDescriptionLib.tickToDecimalString(lower, token0Decimal, token1Decimal);
    }

    function token0Text(address token) internal view returns (string memory) {
        return string(abi.encodePacked('<text x="16" y="31" font-size="20px">', tokenSymbol(token), "</text>"));
    }

    function token1Text(address token) internal view returns (string memory) {
        return string(abi.encodePacked('<text x="248" y="31" text-anchor="end" font-size="20px">', tokenSymbol(token), "</text>"));
    }

    function tokenSymbol(address token) internal view returns (string memory) {
        string memory symbol = IERC20Metadata(token).symbol();
        bytes32 hash = keccak256(abi.encode(symbol));
        if (hash == WKLAY10_HASH || hash == WKLAY_HASH) {
            return "KLAY";
        } else {
            return symbol;
        }
    }

    function boostImage(uint256 boost) internal pure returns (string memory) {
        string memory image;
        if (boost >= 20) {
        } else if (boost >= 15) {
            return OnPosition.IMAGE();
        } else if (boost >= 10) {
        }
        return OffPosition.IMAGE();
    }

    function feeText(uint24 fee) internal pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    '<text x="29" y="252" text-anchor="middle" font-size="11px">',
                    PositionDescriptionLib.feeToPercentString(fee),
                    "</text>"
                )
            );
    }

    function priceRangeText(PosParam memory param) internal view returns (string memory) {
        bool minRange = param.lower < -886272;
        bool maxRange = param.upper > 886272;
        if (minRange && maxRange) {
            return '<text x="132" y="252" text-anchor="middle" font-size="11px">Full Range</text>';
        }
        string memory lower = minRange ? "Min" : priceText(param.lower, param.token0, param.token1);
        string memory upper = maxRange ? "Max" : priceText(param.upper, param.token0, param.token1);
        return
            string(
                abi.encodePacked(
                    '<text x="125" y="252" text-anchor="end" font-size="11px">',
                    lower,
                    "</text>",
                    BiArrow.IMAGE(),
                    '<text x="150" y="252" text-anchor="start" font-size="11px">',
                    upper,
                    "</text>"
                )
            );
    }

    function inRange(uint160 curr, int24 lower, int24 upper) internal pure returns (bool) {
        return TickMath.getSqrtRatioAtTick(lower) <= curr && curr < TickMath.getSqrtRatioAtTick(upper);
    }
}
