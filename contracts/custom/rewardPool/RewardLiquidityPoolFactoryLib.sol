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

import "./RewardLiquidityPool.sol";
import "../../interfaces/IMasterDeployer.sol";

library RewardLiquidityPoolFactoryLib {
    function createPool(bytes memory _deployData, address masterDeployer) external returns (address) {
        // Salt is not actually needed since `_deployData` is part of creationCode and already contains the salt.
        bytes32 salt = keccak256(_deployData);
        return address(new RewardLiquidityPool{salt: salt}(_deployData, masterDeployer));
    }
}
