import fs from "fs";

if (fs.existsSync('types/index.ts')) {
  import("./accounts");
  import( "./addresses");
  import("./dashboard");
  import("./erc20");
  import("./pool");
  import("./position");
  import("./swap");
  import("./time");
  import("./yieldPool");
}
