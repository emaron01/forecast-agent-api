import { Pool } from "pg";

export const runtime = "nodejs";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool__: Pool | undefined;
}

function makeSharedPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

// IMPORTANT:
// - Shared pool per Node process (avoids connection churn across route modules).
// - This is NOT question caching; question_definitions are still queried each time.
export const pool: Pool = global.__pgPool__ || (global.__pgPool__ = makeSharedPool());

