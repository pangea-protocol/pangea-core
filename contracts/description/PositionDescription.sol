// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IConcentratedLiquidityPoolManager.sol";
import "../interfaces/INFTDescriptor.sol";
import "./PositionDescriptionLib.sol";
import "./SVGGenerator.sol";

/// @notice generate tokenURI for given Position NFT
contract PositionDescription is INFTDescriptor, Initializable {
    using Strings for uint256;

    IConcentratedLiquidityPoolManager public positionManager;

    function initialize(address _positionManager) external initializer {
        positionManager = IConcentratedLiquidityPoolManager(_positionManager);
    }

    function tokenURI(uint256 positionId) external view returns (string memory) {
        return _tokenURI(positionId, _generateSVG(positionId));
    }

    function _generateSVG(uint256 positionId) internal view returns (string memory svg) {
        IConcentratedLiquidityPoolManager.Position memory position = positionManager.positions(positionId);
        IConcentratedLiquidityPool iPool = IConcentratedLiquidityPool(position.pool);
        return
            SVGGenerator.positionSVG(
                SVGGenerator.PosParam({
                    token0: iPool.token0(),
                    token1: iPool.token1(),
                    fee: iPool.swapFee(),
                    curr: iPool.price(),
                    lower: position.lower,
                    upper: position.upper
                })
            );
    }

    function _tokenURI(uint256 positionId, string memory svg) internal pure returns (string memory output) {
        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name": "Position #',
                        positionId.toString(),
                        '", "description": "PANGEA Position NFT, this NFT represents a liquidity position in PANGEA", "image": "data:image/svg+xml;base64,',
                        Base64.encode(bytes(svg)),
                        '"}'
                    )
                )
            )
        );
        output = string(abi.encodePacked("data:application/json;base64,", json));
    }
}
