// `server-only` is a Next.js package that throws at import time if used outside
// the server environment. In this repo's Node smoke tests (`node --test`),
// there's no Next.js runtime, so we stub it out as a no-op to allow imports
// of server-side modules to resolve.
module.exports = {};

