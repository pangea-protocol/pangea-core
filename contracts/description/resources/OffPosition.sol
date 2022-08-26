// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

library OffPosition {
    function IMAGE() external pure returns (string memory) {
        return
            '<image href="data:image/jpg;base64,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" width="264" height="264"/>';
    }
}