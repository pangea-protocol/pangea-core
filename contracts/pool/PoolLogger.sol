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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../interfaces/IPoolLogger.sol";
import "../interfaces/IMasterDeployer.sol";

contract PoolLogger is IPoolLogger, OwnableUpgradeable {
    IMasterDeployer public masterDeployer;

    function initialize(address _masterDeployer) external initializer {
        __Ownable_init();

        require(_masterDeployer != address(0), "ZERO_ADDRESS");
        masterDeployer = IMasterDeployer(_masterDeployer);
    }

    modifier poolOnly() {
        if (masterDeployer.pools(msg.sender)) {
            _;
        }
    }

    function emitMint(LiquidityLoggingParams memory params) external poolOnly {
        emit Mint(msg.sender, params.lower, params.upper, params.amount0, params.amount1, params.liquidity);
    }

    function emitBurn(LiquidityLoggingParams memory params) external poolOnly {
        emit Burn(msg.sender, params.lower, params.upper, params.amount0, params.amount1, params.liquidity);
    }

    function emitCollect(CollectLoggingParams memory params) external poolOnly {
        emit Collect(msg.sender, params.amount0, params.amount1);
    }

    function emitSwap(SwapLoggingParams memory params) external poolOnly {
        emit Swap(msg.sender, params.zeroForOne, params.amountIn, params.amountOut);
    }

    function emitFlash(FlashLoggingParams memory params) external poolOnly {
        emit Flash(msg.sender, params.sender, params.amount0, params.amount1, params.paid0, params.paid1);
    }
}
