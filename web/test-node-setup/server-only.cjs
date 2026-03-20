// Require hook registered via `--require` in `web/package.json` test script.
// Maps `require("server-only")` to the no-op stub so server-side modules can be
// imported in the Node test runner without throwing. This file must use CommonJS
// (.cjs) because it is loaded before any ESM transform.
const Module = require("module");
const path = require("path");

const mockPath = path.join(__dirname, "..", "__mocks__", "server-only.js");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return mockPath;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

