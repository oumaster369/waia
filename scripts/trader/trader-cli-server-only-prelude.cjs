/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Trader CLI prelude: stub `server-only` for tsx/CJS resolution paths.
 * Vitest aliases the package; Next uses react-server conditions; tsx require() does neither.
 */
const Module = require("node:module");

if (process.env.WAIA_TRADER_CLI === "1") {
  const originalLoad = Module._load;
  Module._load = function traderCliServerOnlyStub(request, parent, isMain) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}
