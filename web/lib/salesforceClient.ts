import crypto from "crypto";
import { pool } from "./pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SalesforceOk<T> = { ok: true; data: T };
export type SalesforceErr = { ok: false; error: string };
export type SalesforceResult<T> = SalesforceOk<T> | SalesforceErr;

export type SalesforceOpportunity = {
  id: string;
  properties: Record<string, string | null>;
  updatedAt?: string;
};

export type SalesforceOpportunityWithAccount = {
  id: string;
  properties: Record<string, string>;
  account_name: string | null;
};

export type SalesforceOwner = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type SalesforceProperty = {
  name: string;
  label: string;
  type: string;
};

type SalesforceConnectionRow = {
  id: string;
  org_id: string;
  sf_org_id: string;
  instance_url: string;
  sf_domain: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date;
  scopes: string[] | null;
  writeback_enabled: boolean;
  sandbox: boolean;
  api_version: string;
};

// ---------------------------------------------------------------------------
// Crypto (AES-256-GCM) — mirrors hubspotClient.ts exactly, separate salt
// ---------------------------------------------------------------------------

function sessionSecret(): string {
  return String(process.env.SESSION_SECRET || "").trim();
}

function sfClientId(): string {
  return String(process.env.SALESFORCE_CLIENT_ID || "").trim();
}

function sfClientSecret(): string {
  return String(process.env.SALESFORCE_CLIENT_SECRET || "").trim();
}

function sfRedirectUri(): string {
  return String(process.env.SALESFORCE_REDIRECT_URI || "").trim();
}

function deriveKey(): Buffer | null {
  const sec = sessionSecret();
  if (!sec) return null;
  // Separate salt from hubspot to ensure key isolation
  return crypto.scryptSync(sec, "salesforce-token-v1", 32);
}

function encryptToken(plain: string): SalesforceResult<string> {
  const key = deriveKey();
  if (!key) return { ok: false, error: "SESSION_SECRET missing" };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ok: true, data: Buffer.concat([iv, tag, enc]).toString("base64url") };
}

function decryptToken(encB64: string): SalesforceResult<string> {
  const key = deriveKey();
  if (!key) return { ok: false, error: "SESSION_SECRET missing" };
  try {
    const raw = Buffer.from(String(encB64 || "").trim(), "base64url");
    if (raw.length < 12 + 16) return { ok: false, error: "Invalid ciphertext" };
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return { ok: true, data: dec.toString("utf8") };
  } catch {
    return { ok: false, error: "Decrypt failed" };
  }
}

export function encryptSalesforceTokenForStorage(plain: string): SalesforceResult<string> {
  return encryptToken(plain);
}

export function decryptSalesforceTokenFromStorage(enc: string): SalesforceResult<string> {
  return decryptToken(enc);
}

// ---------------------------------------------------------------------------
// OAuth state (HMAC-signed, 15-minute TTL) — mirrors hubspotClient.ts
// ---------------------------------------------------------------------------

export function signSalesforceOAuthState(orgId: number): SalesforceResult<string> {
  const sec = sessionSecret();
  if (!sec) return { ok: false, error: "SESSION_SECRET missing" };
  const ts = Date.now();
  const payload = Buffer.from(JSON.stringify({ orgId, ts }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", sec).update(payload).digest("base64url");
  return { ok: true, data: `${payload}.${sig}` };
}

export function verifySalesforceOAuthState(
  state: string,
  maxAgeMs = 15 * 60 * 1000
): SalesforceResult<{ orgId: number }> {
  const sec = sessionSecret();
  if (!sec) return { ok: false, error: "SESSION_SECRET missing" };
  const raw = String(state || "").trim();
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return { ok: false, error: "Invalid state" };
  const payloadB64 = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = crypto.createHmac("sha256", sec).update(payloadB64).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "Invalid state" };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid state" };
  }
  const orgId = Number(parsed?.orgId);
  const ts = Number(parsed?.ts);
  if (!Number.isFinite(orgId) || orgId <= 0 || !Number.isFinite(ts)) {
    return { ok: false, error: "Invalid state" };
  }
  if (Date.now() - ts > maxAgeMs) return { ok: false, error: "State expired" };
  return { ok: true, data: { orgId: Math.trunc(orgId) } };
}

// ---------------------------------------------------------------------------
// OAuth token exchange
// ---------------------------------------------------------------------------

export async function salesforceExchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
  sandbox: boolean;
  codeVerifier?: string;
}): Promise<
  SalesforceResult<{
    access_token: string;
    refresh_token: string;
    instance_url: string;
    sf_org_id: string;
    scope_parts: string[];
  }>
> {
  const clientId = sfClientId();
  const clientSecret = sfClientSecret();
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Salesforce OAuth env missing (SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET)" };
  }

  const tokenUrl = args.sandbox
    ? "https://test.salesforce.com/services/oauth2/token"
    : "https://login.salesforce.com/services/oauth2/token";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
  });
  if (args.codeVerifier) {
    body.set("code_verifier", args.codeVerifier);
  }

  const res = await sfHttpPostForm(tokenUrl, body);
  if (res.ok === false) return { ok: false, error: res.error };

  const access = String(res.json?.access_token || "").trim();
  const refresh = String(res.json?.refresh_token || "").trim();
  const instanceUrl = String(res.json?.instance_url || "").trim().replace(/\/+$/, "");
  if (!access || !refresh || !instanceUrl) {
    return { ok: false, error: "Token exchange incomplete — missing access_token, refresh_token, or instance_url" };
  }

  // Extract org ID from identity URL: https://{instance}/id/{orgId}/{userId}
  const idUrl = String(res.json?.id || "").trim();
  const sfOrgId = idUrl ? (idUrl.split("/").slice(-2, -1)[0] ?? "") : "";

  const scopeStr = String(res.json?.scope || "").trim();
  const scope_parts = scopeStr
    ? scopeStr.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    data: { access_token: access, refresh_token: refresh, instance_url: instanceUrl, sf_org_id: sfOrgId, scope_parts },
  };
}

// ---------------------------------------------------------------------------
// DB + token refresh (row lock) — mirrors hubspotClient.ts exactly
// ---------------------------------------------------------------------------

async function loadConnection(orgId: number): Promise<SalesforceResult<SalesforceConnectionRow>> {
  try {
    const { rows } = await pool.query<SalesforceConnectionRow>(
      `
      SELECT
        id::text AS id,
        org_id::text AS org_id,
        sf_org_id,
        instance_url,
        sf_domain,
        access_token_enc,
        refresh_token_enc,
        token_expires_at,
        scopes,
        writeback_enabled,
        sandbox,
        api_version
      FROM salesforce_connections
      WHERE org_id = $1
      LIMIT 1
      `,
      [orgId]
    );
    const r = rows?.[0];
    if (!r) return { ok: false, error: "Salesforce not connected" };
    return { ok: true, data: r };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function refreshTokensTransactional(
  orgId: number,
  refreshPlain: string,
  instanceUrl: string
): Promise<SalesforceResult<{ access: string; expiresAt: Date }>> {
  const clientId = sfClientId();
  const clientSecret = sfClientSecret();
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Salesforce OAuth env missing" };
  }

  // SFDC refresh token endpoint uses the instance URL, not login.salesforce.com
  const tokenUrl = `${instanceUrl}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshPlain,
  });

  const res = await sfHttpPostForm(tokenUrl, body);
  if (res.ok === false) return { ok: false, error: res.error };

  const access = String(res.json?.access_token || "").trim();
  if (!access) return { ok: false, error: "Token refresh missing access_token" };

  // SFDC access tokens expire in 2 hours by default; refresh tokens are long-lived
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const encAccess = encryptToken(access);
  if (encAccess.ok === false) return { ok: false, error: encAccess.error };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id FROM salesforce_connections WHERE org_id = $1 FOR UPDATE`,
      [orgId]
    );
    if (!rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Salesforce connection removed during refresh" };
    }
    await client.query(
      `
      UPDATE salesforce_connections
         SET access_token_enc = $2,
             token_expires_at = $3,
             updated_at = now()
       WHERE org_id = $1
      `,
      [orgId, encAccess.data, expiresAt.toISOString()]
    );
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: e?.message || String(e) };
  } finally {
    client.release();
  }

  return { ok: true, data: { access, expiresAt } };
}

// ---------------------------------------------------------------------------
// HTTP helpers — mirrors hubspotClient.ts rate limit + retry pattern
// ---------------------------------------------------------------------------

async function sfHttpPostForm(
  url: string,
  body: URLSearchParams
): Promise<{ ok: true; json: any } | { ok: false; error: string; status?: number }> {
  let attempt = 0;
  while (attempt < 8) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const sec = ra ? Number(ra) : NaN;
        const delay = (Number.isFinite(sec) && sec > 0 ? sec * 1000 : 500) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
      if (!res.ok) {
        return { ok: false, error: json?.[0]?.message || json?.error_description || json?.error || text || `HTTP ${res.status}`, status: res.status };
      }
      return { ok: true, json };
    } catch (e: any) {
      if (attempt >= 8) return { ok: false, error: e?.message || String(e) };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { ok: false, error: "Exceeded retries" };
}

async function sfAuthorizedJson(
  orgId: number,
  method: "GET" | "POST" | "PATCH",
  path: string,
  bodyObj?: unknown
): Promise<{ ok: true; status: number; json: any } | { ok: false; error: string; status?: number }> {
  const conn = await loadConnection(orgId);
  if (conn.ok === false) return { ok: false, error: conn.error };

  const decAccess = decryptToken(conn.data.access_token_enc);
  const decRefresh = decryptToken(conn.data.refresh_token_enc);
  if (decAccess.ok === false || decRefresh.ok === false) {
    return { ok: false, error: "Stored tokens invalid" };
  }

  let accessToken = decAccess.data;
  const refreshToken = decRefresh.data;
  const instanceUrl = String(conn.data.instance_url || "").trim();
  const apiVersion = String(conn.data.api_version || "v59.0").trim();

  // Proactive refresh if within 5 minutes of expiry
  const expMs = new Date(conn.data.token_expires_at).getTime();
  if (!Number.isFinite(expMs) || Date.now() > expMs - 5 * 60 * 1000) {
    const ref = await refreshTokensTransactional(orgId, refreshToken, instanceUrl);
    if (ref.ok === false) return { ok: false, error: ref.error };
    accessToken = ref.data.access;
  }

  const url = path.startsWith("http") ? path : `${instanceUrl}/services/data/${apiVersion}${path}`;

  let attempt = 0;
  while (attempt < 8) {
    attempt++;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      };
      if (method !== "GET") headers["Content-Type"] = "application/json";
      const res = await fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(bodyObj ?? {}),
      });
      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const sec = ra ? Number(ra) : NaN;
        const delay = (Number.isFinite(sec) && sec > 0 ? sec * 1000 : 500) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // Reactive token refresh on 401
      if (res.status === 401 && attempt === 1) {
        const ref = await refreshTokensTransactional(orgId, refreshToken, instanceUrl);
        if (ref.ok === false) return { ok: false, error: ref.error, status: 401 };
        accessToken = ref.data.access;
        continue;
      }
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
      if (!res.ok) {
        const msg = Array.isArray(json) ? (json[0]?.message || text) : (json?.message || text || `HTTP ${res.status}`);
        return { ok: false, error: msg, status: res.status };
      }
      return { ok: true, status: res.status, json };
    } catch (e: any) {
      if (attempt >= 8) return { ok: false, error: e?.message || String(e) };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { ok: false, error: "Exceeded retries" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Describe Opportunity fields — equivalent to getDealProperties in hubspotClient */
export async function getOpportunityProperties(
  orgId: number
): Promise<SalesforceResult<SalesforceProperty[]>> {
  const res = await sfAuthorizedJson(orgId, "GET", "/sobjects/Opportunity/describe");
  if (res.ok === false) return { ok: false, error: res.error };
  const fields = Array.isArray(res.json?.fields) ? res.json.fields : [];
  const mapped: SalesforceProperty[] = fields.map((f: any) => ({
    name: String(f?.name || ""),
    label: String(f?.label || f?.name || ""),
    type: String(f?.type || ""),
  }));
  return { ok: true, data: mapped.filter((p) => p.name) };
}

/**
 * Query Opportunities via SOQL with close date window filter.
 * Mirrors getDeals() in hubspotClient — requires closeDateAfter and closeDateBefore.
 */
export async function getOpportunities(
  orgId: number,
  params: {
    closeDateAfter: Date;
    closeDateBefore: Date;
    updatedAfter?: Date;
    extraFields?: string[];
    nextUrl?: string;
  }
): Promise<SalesforceResult<{ opportunities: SalesforceOpportunity[]; nextUrl: string | null }>> {
  if (!params.closeDateAfter || !params.closeDateBefore) {
    return { ok: false, error: "closeDateAfter and closeDateBefore are required" };
  }

  const baseFields = [
    "Id",
    "Name",
    "Amount",
    "CloseDate",
    "StageName",
    "OwnerId",
    "AccountId",
    "CreatedDate",
    "LastModifiedDate",
    "IsClosed",
    "IsWon",
  ];
  const extras = Array.isArray(params.extraFields)
    ? params.extraFields.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const allFields = Array.from(new Set([...baseFields, ...extras]));

  const closeDateAfterStr = params.closeDateAfter.toISOString().slice(0, 10);
  const closeDateBeforeStr = params.closeDateBefore.toISOString().slice(0, 10);

  let whereClause = `CloseDate >= ${closeDateAfterStr} AND CloseDate < ${closeDateBeforeStr}`;
  if (params.updatedAfter) {
    whereClause += ` AND LastModifiedDate >= ${params.updatedAfter.toISOString()}`;
  }

  // Use nextUrl for pagination if provided, otherwise build fresh SOQL query
  let url: string;
  if (params.nextUrl) {
    url = params.nextUrl;
  } else {
    const soql = `SELECT ${allFields.join(", ")} FROM Opportunity WHERE ${whereClause} ORDER BY LastModifiedDate DESC`;
    url = `/query?q=${encodeURIComponent(soql)}`;
  }

  const res = await sfAuthorizedJson(orgId, "GET", url);
  if (res.ok === false) return { ok: false, error: res.error };

  const records = Array.isArray(res.json?.records) ? res.json.records : [];
  const opportunities: SalesforceOpportunity[] = records.map((r: any) => {
    const props: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(r || {})) {
      if (k === "attributes") continue;
      props[k] = v == null ? null : String(v);
    }
    return {
      id: String(r?.Id ?? ""),
      properties: props,
      updatedAt: r?.LastModifiedDate != null ? String(r.LastModifiedDate) : undefined,
    };
  });

  const nextUrl = res.json?.done === false && res.json?.nextRecordsUrl
    ? String(res.json.nextRecordsUrl)
    : null;

  return { ok: true, data: { opportunities: opportunities.filter((o) => o.id), nextUrl } };
}

/** Resolve Account names for a batch of AccountIds. */
async function batchReadAccountNames(
  orgId: number,
  accountIds: string[]
): Promise<SalesforceResult<Map<string, string>>> {
  const unique = Array.from(new Set(accountIds.map((x) => String(x || "").trim()).filter(Boolean)));
  const nameById = new Map<string, string>();
  if (!unique.length) return { ok: true, data: nameById };

  // SOQL IN clause — chunk at 200 to stay well within limits
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const ids = chunk.map((id) => `'${id}'`).join(", ");
    const soql = `SELECT Id, Name FROM Account WHERE Id IN (${ids})`;
    const res = await sfAuthorizedJson(orgId, "GET", `/query?q=${encodeURIComponent(soql)}`);
    if (res.ok === false) return { ok: false, error: res.error };
    for (const r of Array.isArray(res.json?.records) ? res.json.records : []) {
      const id = String(r?.Id ?? "").trim();
      const name = String(r?.Name ?? "").trim();
      if (id) nameById.set(id, name);
    }
  }
  return { ok: true, data: nameById };
}

/** Equivalent to getDealsWithCompanies — resolves Account name per Opportunity. */
export async function getOpportunitiesWithAccounts(
  orgId: number,
  params: {
    closeDateAfter: Date;
    closeDateBefore: Date;
    updatedAfter?: Date;
    extraFields?: string[];
    nextUrl?: string;
  }
): Promise<SalesforceResult<{ opportunities: SalesforceOpportunityWithAccount[]; nextUrl: string | null }>> {
  const page = await getOpportunities(orgId, params);
  if (page.ok === false) return { ok: false, error: page.error };

  const accountIds = page.data.opportunities
    .map((o) => String(o.properties["AccountId"] || "").trim())
    .filter(Boolean);

  const names = await batchReadAccountNames(orgId, accountIds);
  if (names.ok === false) return { ok: false, error: names.error };

  const withAccount: SalesforceOpportunityWithAccount[] = page.data.opportunities.map((o) => {
    const accountId = String(o.properties["AccountId"] || "").trim();
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.properties)) {
      props[k] = v == null ? "" : String(v);
    }
    return {
      id: o.id,
      properties: props,
      account_name: accountId && names.data.has(accountId) ? String(names.data.get(accountId) ?? "") : null,
    };
  });

  return { ok: true, data: { opportunities: withAccount, nextUrl: page.data.nextUrl } };
}

/** Fetch a single Opportunity by Id. */
export async function getOpportunityById(
  orgId: number,
  opportunityId: string,
  extraFields: string[]
): Promise<SalesforceResult<SalesforceOpportunity | null>> {
  const baseFields = ["Id", "Name", "Amount", "CloseDate", "StageName", "OwnerId", "AccountId", "CreatedDate", "LastModifiedDate", "IsClosed", "IsWon"];
  const allFields = Array.from(new Set([...baseFields, ...extraFields.map((x) => String(x || "").trim()).filter(Boolean)]));
  const soql = `SELECT ${allFields.join(", ")} FROM Opportunity WHERE Id = '${String(opportunityId).replace(/'/g, "")}'`;
  const res = await sfAuthorizedJson(orgId, "GET", `/query?q=${encodeURIComponent(soql)}`);
  if (res.ok === false) {
    if (res.status === 404) return { ok: true, data: null };
    return { ok: false, error: res.error };
  }
  const records = Array.isArray(res.json?.records) ? res.json.records : [];
  const r = records[0];
  if (!r?.Id) return { ok: true, data: null };
  const props: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (k === "attributes") continue;
    props[k] = v == null ? null : String(v);
  }
  return {
    ok: true,
    data: { id: String(r.Id), properties: props, updatedAt: r?.LastModifiedDate != null ? String(r.LastModifiedDate) : undefined },
  };
}

/** List Salesforce users (owners) — equivalent to getOwners in hubspotClient. */
export async function getOwners(orgId: number): Promise<SalesforceResult<SalesforceOwner[]>> {
  const soql = `SELECT Id, Email, FirstName, LastName FROM User WHERE IsActive = true ORDER BY LastName ASC`;
  const out: SalesforceOwner[] = [];
  let url: string | null = `/query?q=${encodeURIComponent(soql)}`;
  while (url) {
    const res = await sfAuthorizedJson(orgId, "GET", url);
    if (res.ok === false) return { ok: false, error: res.error };
    for (const r of Array.isArray(res.json?.records) ? res.json.records : []) {
      out.push({
        id: String(r?.Id ?? "").trim(),
        email: String(r?.Email ?? "").trim(),
        firstName: String(r?.FirstName ?? "").trim(),
        lastName: String(r?.LastName ?? "").trim(),
      });
    }
    url = res.json?.done === false && res.json?.nextRecordsUrl ? String(res.json.nextRecordsUrl) : null;
  }
  return { ok: true, data: out };
}

/** Update Opportunity fields — equivalent to updateDealProperties in hubspotClient. */
export async function updateOpportunityFields(
  orgId: number,
  opportunityId: string,
  fields: Record<string, string | number | null>
): Promise<SalesforceResult<void>> {
  const res = await sfAuthorizedJson(
    orgId,
    "PATCH",
    `/sobjects/Opportunity/${encodeURIComponent(opportunityId)}`,
    fields
  );
  // SFDC PATCH returns 204 No Content on success
  if (res.ok === false && res.status !== 204) return { ok: false, error: res.error };
  return { ok: true, data: undefined };
}

/**
 * Verify that required custom fields exist on the Opportunity object.
 * Called from the properties/route.ts endpoint before enabling writeback.
 * Returns list of missing field API names so the UI can instruct the SFDC admin.
 */
export async function verifyWritebackFields(
  orgId: number,
  requiredApiNames: string[]
): Promise<SalesforceResult<{ valid: boolean; missingFields: string[] }>> {
  const propsRes = await getOpportunityProperties(orgId);
  if (propsRes.ok === false) return { ok: false, error: propsRes.error };
  const existing = new Set(propsRes.data.map((p) => p.name));
  const missingFields = requiredApiNames.filter((f) => !existing.has(f));
  return { ok: true, data: { valid: missingFields.length === 0, missingFields } };
}

/**
 * Push Matthew scores to Salesforce Opportunity custom fields.
 * Mirrors writeMatthewScoresToHubSpotDeal — never throws.
 */
export async function writeMatthewScoresToSalesforceOpportunity(args: {
  orgId: number;
  opportunityPublicId: string;
}): Promise<SalesforceResult<{ skipped?: string }>> {
  try {
    const { orgId, opportunityPublicId } = args;
    const pub = String(opportunityPublicId || "").trim();
    if (!orgId || !pub) return { ok: true, data: { skipped: "missing_args" } };

    const conn = await loadConnection(orgId);
    if (conn.ok === false) return { ok: true, data: { skipped: "not_connected" } };
    if (!conn.data.writeback_enabled) return { ok: true, data: { skipped: "writeback_off" } };

    const { rows: mappingRows } = await pool.query<{
      sf_field: string;
      mode: string;
      sfdc_api_name: string | null;
    }>(
      `
      SELECT sf_field, mode, sfdc_api_name
      FROM salesforce_writeback_mappings
      WHERE org_id = $1
        AND sf_field = ANY($2::text[])
      `,
      [orgId, ["health_initial", "health_current", "risk_summary", "next_steps"]]
    );
    if (!mappingRows.length) return { ok: true, data: { skipped: "not_configured" } };

    const { rows: oRows } = await pool.query(
      `
      SELECT
        o.id,
        o.public_id::text AS public_id,
        o.crm_opp_id,
        o.baseline_health_score,
        o.baseline_health_score_ts,
        o.health_score,
        o.risk_summary,
        o.next_steps
      FROM opportunities o
      WHERE o.org_id = $1
        AND o.public_id::text = $2
      LIMIT 1
      `,
      [orgId, pub]
    );
    const opp = oRows?.[0] as any;
    if (!opp?.crm_opp_id) return { ok: true, data: { skipped: "no_crm_id" } };

    const sfOppId = String(opp.crm_opp_id).trim();
    const mappingByField = new Map(
      mappingRows.map((row) => [String(row.sf_field || "").trim(), row] as const)
    );

    const fields: Record<string, string | number | null> = {};

    for (const sfField of ["health_initial", "health_current", "risk_summary", "next_steps"] as const) {
      const mapping = mappingByField.get(sfField);
      if (!mapping?.sfdc_api_name) continue;
      const apiName = String(mapping.sfdc_api_name).trim();
      if (!apiName) continue;

      if (sfField === "health_initial") {
        if (!opp.baseline_health_score_ts) continue;
        // Only write initial score once — check if already set
        const existing = await getOpportunityById(orgId, sfOppId, [apiName]);
        if (existing.ok === false) return { ok: false, error: existing.error };
        const existingVal = existing.data?.properties?.[apiName];
        if (existingVal != null && String(existingVal).trim() !== "") continue;
        fields[apiName] = Math.round((Number(opp.baseline_health_score || 0) / 30) * 100);
        continue;
      }
      if (sfField === "health_current") {
        fields[apiName] = Math.round((Number(opp.health_score || 0) / 30) * 100);
        continue;
      }
      if (sfField === "risk_summary") {
        fields[apiName] = String(opp.risk_summary ?? "");
        continue;
      }
      if (sfField === "next_steps") {
        fields[apiName] = String(opp.next_steps ?? "");
      }
    }

    if (!Object.keys(fields).length) return { ok: true, data: { skipped: "nothing_to_write" } };

    const wb = await updateOpportunityFields(orgId, sfOppId, fields);
    if (wb.ok === false) return wb;
    return { ok: true, data: {} };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
