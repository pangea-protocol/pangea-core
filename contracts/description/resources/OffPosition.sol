// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.0;

library OffPosition {
    function IMAGE() external pure returns (string memory) {
        return
            '<image href="data:image/jpg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABkAAD/4QNnaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA3LjEtYzAwMCA3OS45Y2NjNGRlOTMsIDIwMjIvMDMvMTQtMTQ6MDc6MjIgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdFJlZj0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlUmVmIyIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9IjA1NzMyNjE2NDY0NTFDRjNBQjFFRTFDM0EzM0Y4MjREIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkJEM0MxRUQxQ0ZGMzExRUM5NUUyREQ3QjY3NUEwRDNFIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkJEM0MxRUQwQ0ZGMzExRUM5NUUyREQ3QjY3NUEwRDNFIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCAyMDIyIE1hY2ludG9zaCI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOmRhYTUxNWVlLWQ3NTAtNDIwZC1iNGVlLTRjOWNhY2VhZDg3NiIgc3RSZWY6ZG9jdW1lbnRJRD0iMDU3MzI2MTY0NjQ1MUNGM0FCMUVFMUMzQTMzRjgyNEQiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+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" width="264" height="244"/>';
    }
}
