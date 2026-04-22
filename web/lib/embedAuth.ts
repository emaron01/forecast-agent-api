import crypto from "node:crypto";
import { pool } from "./pool";

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomToken(): string {
  return b64urlEncode(crypto.randomBytes(32));
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function getOrCreateEmbedUser(orgId: number): Promise<number> {
  // Try to find existing embed user for this org
  const existing = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM hubspot_embed_users WHERE org_id = $1 LIMIT 1`,
    [orgId]
  );
  if (existing.rows[0]) return Number(existing.rows[0].user_id);

  // Create new embed user in a transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query<{ id: number }>(
      `INSERT INTO users (
        org_id, email, role, hierarchy_level, display_name, active,
        first_name, last_name, account_owner_name, manager_user_id,
        admin_has_full_analytics_access, see_all_visibility
      ) VALUES ($1, $2, 'REP', 3, 'HubSpot Embed', true,
        null, null, null, null, false, false)
      RETURNING id`,
      [orgId, `embed-hubspot-${orgId}@internal.salesforecast.io`]
    );
    const userId = Number(userRes.rows[0].id);
    await client.query(
      `INSERT INTO hubspot_embed_users (org_id, user_id) VALUES ($1, $2)
       ON CONFLICT (org_id) DO NOTHING`,
      [orgId, userId]
    );
    await client.query("COMMIT");

    // Re-read in case a concurrent request won the insert race
    const reread = await pool.query<{ user_id: number }>(
      `SELECT user_id FROM hubspot_embed_users WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    return Number(reread.rows[0].user_id);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function createEmbedSession(userId: number): Promise<string> {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  await pool.query(
    `INSERT INTO user_sessions (user_id, session_token_hash, expires_at, created_at)
     VALUES ($1, $2, now() + interval '1 hour', now())`,
    [userId, tokenHash]
  );
  return token;
}

export async function resolveHubSpotDeal(args: {
  portalId: string;
  dealId: string;
}): Promise<{ orgId: number; opportunityPublicId: string } | null> {
  const { portalId, dealId } = args;

  const connRes = await pool.query<{ org_id: number }>(
    `SELECT org_id FROM hubspot_connections 
     WHERE hub_id::text = $1 
     LIMIT 1`,
    [String(portalId).trim()]
  );
  if (!connRes.rows[0]) return null;
  const orgId = Number(connRes.rows[0].org_id);

  const oppRes = await pool.query<{ public_id: string }>(
    `SELECT public_id::text AS public_id 
     FROM opportunities 
     WHERE org_id = $1 
       AND crm_opp_id_norm = lower(trim($2))
     LIMIT 1`,
    [orgId, String(dealId).trim()]
  );
  if (!oppRes.rows[0]) return null;

  return { orgId, opportunityPublicId: String(oppRes.rows[0].public_id) };
}
