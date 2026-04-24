import crypto from "crypto";
import type { HubSpotConnectionHubTier } from "./db";
import { pool } from "./pool";

export type { HubSpotConnectionHubTier } from "./db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HubSpotOk<T> = { ok: true; data: T };
export type HubSpotErr = { ok: false; error: string };
export type HubSpotResult<T> = HubSpotOk<T> | HubSpotErr;

export type HubSpotProperty = {
  name: string;
  label: string;
  type: string;
  fieldType?: string;
  displayFormat?: string;
};

export type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
  updatedAt?: string;
};

/** Deal row with `company_name` from HubSpot deal→company association (not a deal property). */
export type HubSpotDealWithCompany = {
  id: string;
  properties: Record<string, string>;
  /** Primary associated company name, or null when no company is linked. */
  company_name: string | null;
};

export type HubSpotEngagement = {
  id: string;
  type: "NOTE" | "CALL" | string;
  body: string;
};

export type HubSpotOwner = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

type HubspotConnectionRow = {
  id: string;
  org_id: string;
  hub_id: string;
  hub_domain: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date;
  scopes: string[] | null;
  writeback_enabled: boolean;
  hub_tier: HubSpotConnectionHubTier;
};

// ---------------------------------------------------------------------------
// Crypto (AES-256-GCM) — tokens never leave this module decrypted except in-memory for API calls
// ---------------------------------------------------------------------------

function sessionSecret(): string {
  const s = String(process.env.SESSION_SECRET || "").trim();
  if (!s) return "";
  return s;
}

function hubspotOAuthClientId(): string {
  return String(process.env.HUBSPOT_CLIENT_ID || "").trim();
}

function hubspotOAuthClientSecret(): string {
  return String(process.env.HUBSPOT_APP_CLIENT_SECRET || process.env.HUBSPOT_CLIENT_SECRET || "").trim();
}

function deriveKey(): Buffer | null {
  const sec = sessionSecret();
  if (!sec) return null;
  return crypto.scryptSync(sec, "hubspot-token-v1", 32);
}

function encryptToken(plain: string): HubSpotResult<string> {
  const key = deriveKey();
  if (!key) return { ok: false, error: "SESSION_SECRET missing" };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ok: true, data: Buffer.concat([iv, tag, enc]).toString("base64url") };
}

function decryptToken(encB64: string): HubSpotResult<string> {
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

export function encryptHubSpotTokenForStorage(plain: string): HubSpotResult<string> {
  return encryptToken(plain);
}

export function decryptHubSpotTokenFromStorage(enc: string): HubSpotResult<string> {
  return decryptToken(enc);
}

// ---------------------------------------------------------------------------
// DB + token refresh (row lock)
// ---------------------------------------------------------------------------

async function loadConnection(orgId: number): Promise<HubSpotResult<HubspotConnectionRow>> {
  try {
    const { rows } = await pool.query<HubspotConnectionRow>(
      `
      SELECT
        id::text AS id,
        org_id::text AS org_id,
        hub_id,
        hub_domain,
        access_token_enc,
        refresh_token_enc,
        token_expires_at,
        scopes,
        writeback_enabled,
        hub_tier::text AS hub_tier
      FROM hubspot_connections
      WHERE org_id = $1
      LIMIT 1
      `,
      [orgId]
    );
    const r = rows?.[0];
    if (!r) return { ok: false, error: "HubSpot not connected" };
    return { ok: true, data: r };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function refreshTokensTransactional(
  orgId: number,
  refreshPlain: string
): Promise<HubSpotResult<{ access: string; refresh: string; expiresAt: Date }>> {
  const clientId = hubspotOAuthClientId();
  const clientSecret = hubspotOAuthClientSecret();
  if (!clientId || !clientSecret) return { ok: false, error: "HubSpot OAuth env missing" };

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshPlain,
  });

  const res = await hubspotHttpPostFormWithRateLimit("https://api.hubapi.com/oauth/v1/token", body);
  if (res.ok === false) return { ok: false, error: res.error };

  const access = String(res.json?.access_token || "").trim();
  const refresh = String(res.json?.refresh_token || refreshPlain).trim();
  const expSec = Number(res.json?.expires_in || 0);
  if (!access) return { ok: false, error: "Token response missing access_token" };
  const expiresAt = new Date(Date.now() + (Number.isFinite(expSec) && expSec > 0 ? expSec : 1800) * 1000);

  const encAccess = encryptToken(access);
  const encRefresh = encryptToken(refresh);
  if (encAccess.ok === false) return { ok: false, error: encAccess.error };
  if (encRefresh.ok === false) return { ok: false, error: encRefresh.error };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<HubspotConnectionRow>(
      `SELECT id FROM hubspot_connections WHERE org_id = $1 FOR UPDATE`,
      [orgId]
    );
    if (!rows?.length) {
      await client.query("ROLLBACK");
      return { ok: false, error: "HubSpot connection removed during refresh" };
    }
    await client.query(
      `
      UPDATE hubspot_connections
         SET access_token_enc = $2,
             refresh_token_enc = $3,
             token_expires_at = $4,
             updated_at = now()
       WHERE org_id = $1
      `,
      [orgId, encAccess.data, encRefresh.data, expiresAt.toISOString()]
    );
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: e?.message || String(e) };
  } finally {
    client.release();
  }

  return { ok: true, data: { access, refresh, expiresAt } };
}

let rateLimitChain: Promise<void> = Promise.resolve();

export async function handleRateLimit(retryAfterSec?: number): Promise<void> {
  const base = Number.isFinite(retryAfterSec) && (retryAfterSec as number) > 0 ? (retryAfterSec as number) * 1000 : 500;
  const jitter = Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, base + jitter));
}

async function hubspotHttpPostFormWithRateLimit(
  url: string,
  body: URLSearchParams
): Promise<{ ok: true; json: any } | { ok: false; error: string; status?: number }> {
  let attempt = 0;
  let delay = 800;
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
        await handleRateLimit(Number.isFinite(sec) ? sec : undefined);
        delay = Math.min(delay * 2, 60_000);
        continue;
      }
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (!res.ok) {
        return { ok: false, error: json?.message || text || `HTTP ${res.status}`, status: res.status };
      }
      return { ok: true, json };
    } catch (e: any) {
      await handleRateLimit();
      delay = Math.min(delay * 2, 60_000);
      if (attempt >= 8) return { ok: false, error: e?.message || String(e) };
    }
  }
  return { ok: false, error: "Exceeded retries" };
}

async function hubspotAuthorizedJson(
  orgId: number,
  method: "GET" | "POST" | "PATCH",
  url: string,
  bodyObj?: unknown
): Promise<{ ok: true; status: number; json: any } | { ok: false; error: string; status?: number }> {
  rateLimitChain = rateLimitChain.then(() => Promise.resolve());
  await rateLimitChain;

  const conn = await loadConnection(orgId);
  if (conn.ok === false) return { ok: false, error: conn.error };

  const decRefresh = decryptToken(conn.data.refresh_token_enc);
  const decAccess = decryptToken(conn.data.access_token_enc);
  if (decRefresh.ok === false || decAccess.ok === false) return { ok: false, error: "Stored tokens invalid" };

  let accessToken = decAccess.data;
  let refreshToken = decRefresh.data;
  const expMs = new Date(conn.data.token_expires_at).getTime();
  if (!Number.isFinite(expMs) || Date.now() > expMs - 5 * 60 * 1000) {
    const ref = await refreshTokensTransactional(orgId, refreshToken);
    if (ref.ok === false) return { ok: false, error: ref.error };
    accessToken = ref.data.access;
    refreshToken = ref.data.refresh;
  }

  let attempt = 0;
  let backoff = 800;
  while (attempt < 8) {
    attempt++;
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
      if (method !== "GET") headers["Content-Type"] = "application/json";
      const res = await fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(bodyObj ?? {}),
      });
      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const sec = ra ? Number(ra) : NaN;
        await handleRateLimit(Number.isFinite(sec) ? sec : undefined);
        backoff = Math.min(backoff * 2, 60_000);
        continue;
      }
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (res.status === 401 && attempt === 1) {
        const ref = await refreshTokensTransactional(orgId, refreshToken);
        if (ref.ok === false) return { ok: false, error: ref.error, status: 401 };
        accessToken = ref.data.access;
        refreshToken = ref.data.refresh;
        continue;
      }
      if (!res.ok) {
        return { ok: false, error: json?.message || text || `HTTP ${res.status}`, status: res.status };
      }
      return { ok: true, status: res.status, json };
    } catch (e: any) {
      await handleRateLimit();
      backoff = Math.min(backoff * 2, 60_000);
      if (attempt >= 8) return { ok: false, error: e?.message || String(e) };
    }
  }
  return { ok: false, error: "Exceeded retries" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDealProperties(orgId: number): Promise<HubSpotResult<HubSpotProperty[]>> {
  const url = "https://api.hubapi.com/crm/v3/properties/deals";
  const res = await hubspotAuthorizedJson(orgId, "GET", url);
  if (res.ok === false) return { ok: false, error: res.error };
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  const mapped: HubSpotProperty[] = results.map((r: any) => ({
    name: String(r?.name || ""),
    label: String(r?.label || r?.name || ""),
    type: String(r?.type || ""),
    fieldType: r?.fieldType != null ? String(r.fieldType) : undefined,
    displayFormat: r?.displayFormat != null ? String(r.displayFormat) : undefined,
  }));
  return { ok: true, data: mapped.filter((p) => p.name) };
}

export async function getDeals(
  orgId: number,
  params: {
    after?: string;
    limit?: number;
    updatedAfter?: Date;
    closeDateAfter?: Date;
    closeDateBefore?: Date;
    /** Additional HubSpot deal property internal names to include in search results. */
    extraProperties?: string[];
  }
): Promise<HubSpotResult<{ deals: HubSpotDeal[]; nextCursor: string | null }>> {
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 100));
  if (!params.closeDateAfter || !params.closeDateBefore) {
    return { ok: false, error: "closeDateAfter and closeDateBefore are required for deal search" };
  }
  const filters: any[] = [];
  if (params.closeDateAfter) {
    filters.push({
      propertyName: "closedate",
      operator: "GTE",
      value: params.closeDateAfter.toISOString().slice(0, 10),
    });
  }
  if (params.closeDateBefore) {
    filters.push({
      propertyName: "closedate",
      operator: "LT",
      value: params.closeDateBefore.toISOString().slice(0, 10),
    });
  }
  if (params.updatedAfter) {
    filters.push({
      propertyName: "hs_lastmodifieddate",
      operator: "GTE",
      value: params.updatedAfter.toISOString(),
    });
  }

  const baseProps = [
    "dealname",
    "amount",
    "closedate",
    "dealstage",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
    "hs_object_id",
  ];
  const extras = Array.isArray(params.extraProperties)
    ? params.extraProperties.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const body: any = {
    limit,
    properties: Array.from(new Set([...baseProps, ...extras])),
    // HubSpot search requires at least one filter group when using filters.
    filterGroups: [{ filters }],
  };
  if (params.after) body.after = params.after;

  const res = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/objects/deals/search", body);
  if (res.ok === false) return { ok: false, error: res.error };
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  const deals: HubSpotDeal[] = results.map((r: any) => ({
    id: String(r?.id ?? ""),
    properties: (r?.properties || {}) as Record<string, string | null>,
    updatedAt: r?.updatedAt != null ? String(r.updatedAt) : undefined,
  }));
  const paging = res.json?.paging;
  const nextCursor = paging?.next?.after != null ? String(paging.next.after) : null;
  return { ok: true, data: { deals: deals.filter((d) => d.id), nextCursor } };
}

function hubspotPropertiesToStrings(props: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props || {})) {
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

/** First associated company id per deal (CRM v4 batch read). */
async function batchReadDealToPrimaryCompanyIds(
  orgId: number,
  dealIds: string[]
): Promise<HubSpotResult<Map<string, string>>> {
  const ids = dealIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (!ids.length) return { ok: true, data: new Map() };
  const res = await hubspotAuthorizedJson(
    orgId,
    "POST",
    "https://api.hubapi.com/crm/v4/associations/deals/companies/batch/read",
    { inputs: ids.map((id) => ({ id })) }
  );
  if (res.ok === false) return { ok: false, error: res.error };
  const map = new Map<string, string>();
  for (const row of Array.isArray(res.json?.results) ? res.json.results : []) {
    const dealId = String(row?.from?.id ?? "").trim();
    const toList = Array.isArray(row?.to) ? row.to : [];
    const first = toList[0];
    const cid = first?.toObjectId != null ? String(first.toObjectId).trim() : "";
    if (dealId && cid) map.set(dealId, cid);
  }
  return { ok: true, data: map };
}

async function batchReadCompanyNamesById(
  orgId: number,
  companyIds: string[]
): Promise<HubSpotResult<Map<string, string>>> {
  const unique = Array.from(new Set(companyIds.map((x) => String(x || "").trim()).filter(Boolean)));
  const nameById = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/objects/companies/batch/read", {
      properties: ["name"],
      inputs: chunk.map((id) => ({ id })),
    });
    if (res.ok === false) return { ok: false, error: res.error };
    for (const r of Array.isArray(res.json?.results) ? res.json.results : []) {
      const id = String(r?.id ?? "").trim();
      const n = r?.properties?.name == null ? "" : String(r.properties.name);
      if (id) nameById.set(id, n);
    }
  }
  return { ok: true, data: nameById };
}

/**
 * Search deals via {@link getDeals} (`POST /crm/v3/objects/deals/search`), then resolve company names from
 * deal→company associations using `POST /crm/v4/associations/deals/companies/batch/read` plus
 * `POST /crm/v3/objects/companies/batch/read` (deduped company IDs per page). HubSpot search responses do not
 * reliably include association payloads when requesting pseudo-properties on the search call, so association
 * IDs are always taken from the v4 batch read.
 */
export async function getDealsWithCompanies(
  orgId: number,
  params: {
    after?: string;
    limit?: number;
    updatedAfter?: Date;
    closeDateAfter?: Date;
    closeDateBefore?: Date;
    extraProperties?: string[];
  }
): Promise<HubSpotResult<{ deals: HubSpotDealWithCompany[]; nextCursor: string | null }>> {
  const page = await getDeals(orgId, params);
  if (page.ok === false) return { ok: false, error: page.error };

  const deals = page.data.deals;
  const dealIds = deals.map((d) => d.id);
  const assoc = await batchReadDealToPrimaryCompanyIds(orgId, dealIds);
  if (assoc.ok === false) return { ok: false, error: assoc.error };

  const companyIds = Array.from(new Set(assoc.data.values()));
  const names = await batchReadCompanyNamesById(orgId, companyIds);
  if (names.ok === false) return { ok: false, error: names.error };

  const withCompany: HubSpotDealWithCompany[] = deals.map((d) => {
    const cid = assoc.data.get(d.id) || "";
    let company_name: string | null = null;
    if (cid) {
      company_name = names.data.has(cid) ? String(names.data.get(cid) ?? "") : "";
    }
    return {
      id: d.id,
      properties: hubspotPropertiesToStrings(d.properties),
      company_name,
    };
  });

  return { ok: true, data: { deals: withCompany, nextCursor: page.data.nextCursor } };
}

export async function getDealByIdWithCompany(
  orgId: number,
  dealId: string,
  extraProps: string[]
): Promise<HubSpotResult<HubSpotDealWithCompany | null>> {
  const dealRes = await getDealById(orgId, dealId, extraProps);
  if (dealRes.ok === false) return { ok: false, error: dealRes.error };
  if (!dealRes.data) return { ok: true, data: null };
  const id = String(dealRes.data.id || "").trim();
  const assoc = await batchReadDealToPrimaryCompanyIds(orgId, id ? [id] : []);
  if (assoc.ok === false) return { ok: false, error: assoc.error };
  const cid = id ? assoc.data.get(id) || "" : "";
  let company_name: string | null = null;
  if (cid) {
    const names = await batchReadCompanyNamesById(orgId, [cid]);
    if (names.ok === false) return { ok: false, error: names.error };
    company_name = names.data.has(cid) ? String(names.data.get(cid) ?? "") : "";
  }
  return {
    ok: true,
    data: {
      id: dealRes.data.id,
      properties: hubspotPropertiesToStrings(dealRes.data.properties),
      company_name,
    },
  };
}

export async function getDealById(orgId: number, dealId: string, extraProps: string[]): Promise<HubSpotResult<HubSpotDeal | null>> {
  const props = Array.from(
    new Set(["dealname", "amount", "closedate", "dealstage", "hubspot_owner_id", "createdate", "hs_object_id", ...extraProps.map((x) => String(x || "").trim()).filter(Boolean)])
  );
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${encodeURIComponent(props.join(","))}`;
  const res = await hubspotAuthorizedJson(orgId, "GET", url);
  if (res.ok === false) {
    if (res.status === 404) return { ok: true, data: null };
    return { ok: false, error: res.error };
  }
  const r = res.json;
  if (!r?.id) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      id: String(r.id),
      properties: (r?.properties || {}) as Record<string, string | null>,
      updatedAt: r?.updatedAt != null ? String(r.updatedAt) : undefined,
    },
  };
}

async function listAssociatedObjectIds(
  orgId: number,
  dealId: string,
  toObjectType: string
): Promise<HubSpotResult<string[]>> {
  const url = `https://api.hubapi.com/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/${encodeURIComponent(toObjectType)}`;
  const res = await hubspotAuthorizedJson(orgId, "GET", url);
  if (res.ok === false) {
    if (res.status === 404) return { ok: true, data: [] };
    return { ok: false, error: res.error };
  }
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  const ids = results.map((x: any) => String(x?.toObjectId ?? x?.id ?? "").trim()).filter(Boolean);
  return { ok: true, data: ids };
}

async function batchReadNoteBodies(orgId: number, ids: string[]): Promise<HubSpotResult<string[]>> {
  if (!ids.length) return { ok: true, data: [] };
  const inputs = ids.slice(0, 100).map((id) => ({ id }));
  const res = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/objects/notes/batch/read", {
    properties: ["hs_note_body", "hs_timestamp"],
    inputs,
  });
  if (res.ok === false) return { ok: false, error: res.error };
  const out: string[] = [];
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  for (const r of results) {
    const t = String(r?.properties?.hs_note_body ?? "").trim();
    if (t) out.push(t);
  }
  return { ok: true, data: out };
}

async function batchReadCallBodies(orgId: number, ids: string[]): Promise<HubSpotResult<string[]>> {
  if (!ids.length) return { ok: true, data: [] };
  const inputs = ids.slice(0, 100).map((id) => ({ id }));
  const res = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/objects/calls/batch/read", {
    properties: ["hs_call_transcript", "hs_call_body", "hs_timestamp"],
    inputs,
  });
  if (res.ok === false) return { ok: false, error: res.error };
  const out: string[] = [];
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  for (const r of results) {
    const t = String(r?.properties?.hs_call_transcript ?? r?.properties?.hs_call_body ?? "").trim();
    if (t) out.push(t);
  }
  return { ok: true, data: out };
}

export async function getDealEngagements(orgId: number, dealId: string): Promise<HubSpotResult<HubSpotEngagement[]>> {
  const notes = await listAssociatedObjectIds(orgId, dealId, "notes");
  if (notes.ok === false) return { ok: false, error: notes.error };
  const calls = await listAssociatedObjectIds(orgId, dealId, "calls");
  if (calls.ok === false) return { ok: false, error: calls.error };

  const noteBodies = await batchReadNoteBodies(orgId, notes.data);
  if (noteBodies.ok === false) return { ok: false, error: noteBodies.error };
  const callBodies = await batchReadCallBodies(orgId, calls.data);
  if (callBodies.ok === false) return { ok: false, error: callBodies.error };

  const engagements: HubSpotEngagement[] = [];
  notes.data.forEach((id, i) => engagements.push({ id, type: "NOTE", body: noteBodies.data[i] || "" }));
  calls.data.forEach((id, i) => engagements.push({ id, type: "CALL", body: callBodies.data[i] || "" }));
  return { ok: true, data: engagements };
}

/**
 * Lists CRM owners (`GET /crm/v3/owners?limit=100`), following `paging.next.after` when present.
 */
export async function getOwners(orgId: number): Promise<HubSpotResult<HubSpotOwner[]>> {
  const out: HubSpotOwner[] = [];
  let after: string | undefined;
  for (;;) {
    const url = new URL("https://api.hubapi.com/crm/v3/owners");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const res = await hubspotAuthorizedJson(orgId, "GET", url.toString());
    if (res.ok === false) return { ok: false, error: res.error };
    const results = Array.isArray(res.json?.results) ? res.json.results : [];
    for (const r of results) {
      out.push({
        id: String(r?.id ?? "").trim(),
        email: String(r?.email ?? "").trim(),
        firstName: String(r?.firstName ?? "").trim(),
        lastName: String(r?.lastName ?? "").trim(),
      });
    }
    const next = res.json?.paging?.next?.after;
    if (next == null || String(next).trim() === "") break;
    after = String(next).trim();
    if (!results.length) break;
  }
  return { ok: true, data: out };
}

export async function getOwnerEmailOrName(orgId: number, ownerId: string): Promise<HubSpotResult<string>> {
  const id = String(ownerId || "").trim();
  if (!id) return { ok: true, data: "" };
  const url = `https://api.hubapi.com/crm/v3/owners/${encodeURIComponent(id)}`;
  const res = await hubspotAuthorizedJson(orgId, "GET", url);
  if (res.ok === false) return { ok: true, data: "" };
  const email = String(res.json?.email || "").trim();
  const first = String(res.json?.firstName || "").trim();
  const last = String(res.json?.lastName || "").trim();
  const name = [first, last].filter(Boolean).join(" ").trim();
  return { ok: true, data: email || name || id };
}

export async function updateDealProperties(
  orgId: number,
  dealId: string,
  properties: Record<string, string>
): Promise<HubSpotResult<void>> {
  const res = await hubspotAuthorizedJson(orgId, "PATCH", `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    properties,
  });
  if (res.ok === false) return { ok: false, error: res.error };
  return { ok: true, data: undefined };
}

export async function createWritebackProperties(orgId: number): Promise<HubSpotResult<void>> {
  const groupBody = {
    name: "salesforecast_io",
    label: "SalesForecast.io",
    displayOrder: 999999,
  };
  const gRes = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/properties/deal/groups", groupBody);
  if (gRes.ok === false && gRes.status !== 409 && !/already exists|duplicate|409/i.test(String(gRes.error || ""))) {
    /* non-fatal: property creation may still succeed if group exists from a prior partial run */
  }

  const defs = [
    { name: "sf_health_initial", label: "SF Health Score (Initial)", type: "number", fieldType: "number", groupName: "salesforecast_io" },
    { name: "sf_health_current", label: "SF Health Score (Current)", type: "number", fieldType: "number", groupName: "salesforecast_io" },
    { name: "sf_risk_summary", label: "SF Risk Summary", type: "string", fieldType: "textarea", groupName: "salesforecast_io" },
    { name: "sf_next_steps", label: "SF Next Steps", type: "string", fieldType: "textarea", groupName: "salesforecast_io" },
  ];

  for (const def of defs) {
    const p = await hubspotAuthorizedJson(orgId, "POST", "https://api.hubapi.com/crm/v3/properties/deals", def);
    if (p.ok === false) {
      const msg = String(p.error || "");
      if (/already exists|duplicate|PROPERTY_EXISTS|409/i.test(msg) || p.status === 409) continue;
    }
  }
  return { ok: true, data: undefined };
}

export const createPropertyGroup = createWritebackProperties;

function normalizeSignatureVersion(raw: string): "v1" | "v2" | "v3" | null {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "v1" || v === "1") return "v1";
  if (v === "v2" || v === "2") return "v2";
  if (v === "v3" || v === "3") return "v3";
  return null;
}

function timingSafeEqualHex(expectedHex: string, received: string): boolean {
  const strip = (s: string) =>
    String(s || "")
      .trim()
      .replace(/^sha256=/i, "")
      .trim()
      .toLowerCase();
  const a = strip(expectedHex);
  const b = strip(received);
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function timingSafeEqualBase64(expectedBuf: Buffer, receivedB64: string): boolean {
  const sig = String(receivedB64 || "").trim();
  if (!sig) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(sig, "base64");
  } catch {
    return false;
  }
  if (decoded.length !== expectedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(expectedBuf, decoded);
  } catch {
    return false;
  }
}

/**
 * HubSpot webhook signature verification (v1 CRM subscriptions, v2 workflows/cards, v3 OAuth apps).
 */
export function verifyWebhookSignature(params: {
  clientSecret: string;
  method: string;
  url: string;
  body: string;
  signature: string;
  signatureVersion: string;
  timestamp?: string;
}): boolean {
  const secret = String(params.clientSecret || "").trim();
  if (!secret) return false;

  const version = normalizeSignatureVersion(params.signatureVersion);
  if (!version) return false;

  const method = String(params.method || "POST").toUpperCase();
  const url = String(params.url || "");
  const body = String(params.body ?? "");
  const signature = String(params.signature || "").trim();

  if (!signature) return false;

  try {
    if (version === "v1") {
      const expectedHex = crypto.createHash("sha256").update(secret + body, "utf8").digest("hex");
      return timingSafeEqualHex(expectedHex, signature);
    }

    if (version === "v2") {
      const expectedHex = crypto.createHash("sha256").update(secret + method + url + body, "utf8").digest("hex");
      return timingSafeEqualHex(expectedHex, signature);
    }

    // v3
    const ts = String(params.timestamp ?? "").trim();
    if (!ts) return false;
    let tsMs = Number(ts);
    if (!Number.isFinite(tsMs)) return false;
    // HubSpot may send Unix seconds (10 digits) or milliseconds (13 digits).
    if (tsMs > 0 && tsMs < 1e12) tsMs *= 1000;
    const skewMs = 5 * 60 * 1000;
    if (Date.now() - tsMs > skewMs) return false;

    const source = `${method}${url}${body}${ts}`;
    const hmac = crypto.createHmac("sha256", secret).update(source, "utf8").digest();
    return timingSafeEqualBase64(hmac, signature);
  } catch {
    return false;
  }
}

/** HubSpot OAuth `scope` string for the given portal tier (forecast scopes only for non-starter). */
export function buildOAuthScopes(tier: HubSpotConnectionHubTier): string {
  const base = [
    "crm.objects.companies.read",
    "crm.objects.contacts.read",
    "crm.objects.deals.read",
    "crm.objects.deals.write",
    "crm.objects.owners.read",
    "crm.pipelines.orders.read",
    "crm.schemas.companies.read",
    "crm.schemas.contacts.read",
    "crm.schemas.deals.read",
  ];
  const proScopes = ["crm.objects.forecasts.read", "crm.schemas.forecasts.read"];
  return tier === "starter" ? base.join(" ") : [...base, ...proScopes].join(" ");
}

/** Exchange authorization code for tokens (OAuth callback). */
export function signHubSpotOAuthState(orgId: number, hubTier: HubSpotConnectionHubTier): HubSpotResult<string> {
  const sec = sessionSecret();
  if (!sec) return { ok: false, error: "SESSION_SECRET missing" };
  const ts = Date.now();
  const payload = Buffer.from(JSON.stringify({ orgId, ts, hubTier }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", sec).update(payload).digest("base64url");
  return { ok: true, data: `${payload}.${sig}` };
}

export function verifyHubSpotOAuthState(
  state: string,
  maxAgeMs = 15 * 60 * 1000
): HubSpotResult<{ orgId: number; hubTier: HubSpotConnectionHubTier }> {
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
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: "Invalid state" };
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid state" };
  }
  const orgId = Number(parsed?.orgId);
  const ts = Number(parsed?.ts);
  if (!Number.isFinite(orgId) || orgId <= 0 || !Number.isFinite(ts)) return { ok: false, error: "Invalid state" };
  if (Date.now() - ts > maxAgeMs) return { ok: false, error: "State expired" };
  const rawTier = parsed?.hubTier;
  const hubTier: HubSpotConnectionHubTier =
    rawTier === "starter" || rawTier === "professional" || rawTier === "enterprise" ? rawTier : "professional";
  return { ok: true, data: { orgId: Math.trunc(orgId), hubTier } };
}

export async function hubspotExchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
}): Promise<
  HubSpotResult<{ access_token: string; refresh_token: string; expires_in: number; hub_id?: string; scope_parts: string[] }>
> {
  const clientId = hubspotOAuthClientId();
  const clientSecret = hubspotOAuthClientSecret();
  if (!clientId || !clientSecret) return { ok: false, error: "HubSpot OAuth env missing" };
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: args.redirectUri,
    code: args.code,
  });
  const res = await hubspotHttpPostFormWithRateLimit("https://api.hubapi.com/oauth/v1/token", body);
  if (res.ok === false) return { ok: false, error: res.error };
  const access = String(res.json?.access_token || "").trim();
  const refresh = String(res.json?.refresh_token || "").trim();
  const exp = Number(res.json?.expires_in || 0);
  if (!access || !refresh) return { ok: false, error: "Token exchange incomplete" };
  const scopeStr = String(res.json?.scope || "").trim();
  const scope_parts = scopeStr ? scopeStr.split(/\s+/).map((s) => s.trim()).filter(Boolean) : [];
  return {
    ok: true,
    data: {
      access_token: access,
      refresh_token: refresh,
      expires_in: Number.isFinite(exp) && exp > 0 ? exp : 1800,
      hub_id: res.json?.hub_id != null ? String(res.json.hub_id) : undefined,
      scope_parts,
    },
  };
}

async function fetchHubSpotAccessTokenMetadata(args: {
  accessToken: string;
}): Promise<HubSpotResult<{ accountHubId: string; hubDomain: string }>> {
  try {
    const accessToken = String(args.accessToken || "").trim();
    if (!accessToken) return { ok: false, error: "Access token missing" };

    const res = await fetch(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`,
      {
        method: "GET",
      }
    );
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid HubSpot token metadata response",
      };
    }

    if (!res.ok) {
      return { ok: false, error: json?.message || text || `HTTP ${res.status}` };
    }

    return {
      ok: true,
      data: {
        accountHubId: String(json?.account_hub_id || "").trim(),
        hubDomain: String(json?.hub_domain || "").trim(),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function populateHubSpotHubDomainIfMissing(args: {
  orgId: number;
  accessToken: string;
}): Promise<void> {
  try {
    const orgId = Number(args.orgId);
    if (!Number.isFinite(orgId) || orgId <= 0) return;

    const existing = await pool.query<{ hub_domain: string | null }>(
      `
      SELECT hub_domain
      FROM hubspot_connections
      WHERE org_id = $1
      LIMIT 1
      `,
      [orgId]
    );
    const hubDomain = String(existing.rows[0]?.hub_domain || "").trim();
    if (hubDomain) return;

    const metadata = await fetchHubSpotAccessTokenMetadata({ accessToken: args.accessToken });
    if (metadata.ok === false) {
      console.error(
        JSON.stringify({
          integration: "hubspot",
          event: "hub_domain_lookup_failed",
          orgId,
          error: metadata.error,
        })
      );
      return;
    }

    const nextHubDomain = String(metadata.data.hubDomain || "").trim();
    if (!nextHubDomain) return;

    await pool.query(
      `
      UPDATE hubspot_connections
      SET hub_domain = $1
      WHERE org_id = $2
        AND (hub_domain IS NULL OR hub_domain = '')
      `,
      [nextHubDomain, orgId]
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        integration: "hubspot",
        event: "hub_domain_update_failed",
        orgId: Number(args.orgId) || null,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/**
 * After Matthew persists scores, push snapshot fields to HubSpot (if writeback enabled).
 * Reads opportunities + latest audit; never throws.
 */
export async function writeMatthewScoresToHubSpotDeal(args: {
  orgId: number;
  opportunityPublicId: string;
}): Promise<HubSpotResult<{ skipped?: string }>> {
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
      hubspot_property: string | null;
    }>(
      `
      SELECT
        sf_field,
        mode,
        hubspot_property
      FROM hubspot_writeback_mappings
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

    const hubDealId = String(opp.crm_opp_id).trim();

    const fixedSfPropertyByField: Record<string, string> = {
      health_initial: "sf_health_initial",
      health_current: "sf_health_current",
      risk_summary: "sf_risk_summary",
      next_steps: "sf_next_steps",
    };
    const mappingByField = new Map(
      mappingRows.map((row) => [String(row.sf_field || "").trim(), row] as const)
    );
    const dealPropsRes = await getDealProperties(orgId);
    if (dealPropsRes.ok === false) return { ok: false, error: dealPropsRes.error };
    const dealPropByName = new Map(
      dealPropsRes.data.map((prop) => [String(prop.name || "").trim(), prop] as const)
    );

    function targetPropertyUsesPercentageFormat(targetProperty: string): boolean {
      if (targetProperty === "sf_health_initial" || targetProperty === "sf_health_current") return true;
      const target = dealPropByName.get(targetProperty);
      const displayFormat = String(target?.displayFormat || "").trim().toLowerCase();
      return displayFormat === "percentage";
    }

    function formatHealthScoreForHubSpot(rawScore: number, targetProperty: string): number {
      const roundedPercent = Math.round((rawScore / 30) * 100);
      return targetPropertyUsesPercentageFormat(targetProperty) ? roundedPercent / 100 : roundedPercent;
    }

    const props: Record<string, string | number> = {};
    for (const sfField of ["health_initial", "health_current", "risk_summary", "next_steps"] as const) {
      const mapping = mappingByField.get(sfField);
      if (!mapping) continue;

      const mode = String(mapping.mode || "").trim();
      const targetProperty =
        mode === "custom"
          ? String(mapping.hubspot_property || "").trim()
          : fixedSfPropertyByField[sfField];
      if (!targetProperty) continue;

      if (sfField === "health_initial") {
        if (!opp.baseline_health_score_ts) continue;
        const currentRes = await hubspotAuthorizedJson(
          orgId,
          "GET",
          `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(hubDealId)}?properties=${encodeURIComponent(targetProperty)}`
        );
        if (currentRes.ok === false) return { ok: false, error: currentRes.error };
        const existingValue = currentRes.json?.properties?.[targetProperty];
        if (existingValue != null && String(existingValue).trim() !== "") {
          const existingNumeric = Number(existingValue);
          if (
            !targetPropertyUsesPercentageFormat(targetProperty) ||
            !Number.isFinite(existingNumeric) ||
            existingNumeric <= 1
          ) {
            continue;
          }
        }
        const rawBaselineScore = Number(opp.baseline_health_score || 0) || 0;
        props[targetProperty] = formatHealthScoreForHubSpot(rawBaselineScore, targetProperty);
        continue;
      }

      if (sfField === "health_current") {
        const rawHealthScore = Number(opp.health_score || 0) || 0;
        props[targetProperty] = formatHealthScoreForHubSpot(rawHealthScore, targetProperty);
        continue;
      }

      if (sfField === "risk_summary") {
        props[targetProperty] = String(opp.risk_summary ?? "");
        continue;
      }

      if (sfField === "next_steps") {
        props[targetProperty] = String(opp.next_steps ?? "");
      }
    }

    if (!Object.keys(props).length) return { ok: true, data: { skipped: "nothing_to_write" } };

    const wb = await updateDealProperties(orgId, hubDealId, props as unknown as Record<string, string>);
    if (wb.ok === false) return wb;
    return { ok: true, data: {} };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
