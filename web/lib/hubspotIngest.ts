import { pool } from "./pool";
import {
  createFieldMappingSet,
  processIngestionBatch,
  replaceFieldMappings,
  stageIngestionRows,
} from "./db";
import {
  getDealByIdWithCompany,
  getDealEngagements,
  getDealsWithCompanies,
  getOwners,
  type HubSpotDealWithCompany,
} from "./hubspotClient";
import { getIngestQueue, QUEUE_NAME } from "./ingest-queue";

export function getHubspotScoringCloseDateBounds(): { after: Date; before: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const qStartMonth = Math.floor(m / 3) * 3;
  const currentQuarterStart = new Date(Date.UTC(y, qStartMonth, 1));
  const after = new Date(Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() - 6, 1));
  const before = new Date(Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() + 6, 1));
  return { after, before };
}

type HubspotFieldRow = {
  sf_field: string;
  hubspot_property: string | null;
  confidence: string | null;
};

const SF_TO_TARGET: Record<string, string> = {
  deal_name: "opportunity_name",
  amount: "amount",
  close_date: "close_date",
  stage: "sales_stage",
  owner: "rep_name",
  forecast_stage: "forecast_stage",
  product: "product",
  partner_name: "partner_name",
  deal_reg: "deal_registration",
  deal_reg_date: "deal_reg_date",
  deal_reg_id: "deal_reg_id",
};

async function getOrCreateHubspotMappingSetId(orgId: number): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM field_mapping_sets
       WHERE organization_id = $1
         AND source_system = 'hubspot'
       ORDER BY id ASC
       LIMIT 1
      `,
      [orgId]
    );
    if (rows?.[0]?.id) return rows[0].id;
    const created = await createFieldMappingSet({
      organizationId: orgId,
      name: "HubSpot",
      source_system: "hubspot",
    });
    return created?.id || null;
  } catch {
    return null;
  }
}

function buildIngestFieldMappings(rows: HubspotFieldRow[]) {
  const mappings: Array<{ source_field: string; target_field: string }> = [];
  const skipSf = new Set(["notes_source", "company_name", "crm_opp_id", "create_date"]);
  for (const r of rows) {
    if (!r || skipSf.has(r.sf_field)) continue;
    const tgt = SF_TO_TARGET[r.sf_field];
    const src = String(r.hubspot_property || "").trim();
    if (!tgt || !src) continue;
    mappings.push({ source_field: src, target_field: tgt });
  }
  mappings.push({ source_field: "__sf_company_name__", target_field: "account_name" });
  mappings.push({ source_field: "__sf_crm_opp_id__", target_field: "crm_opp_id" });
  mappings.push({ source_field: "__sf_create_date__", target_field: "create_date_raw" });
  mappings.push({ source_field: "__sf_comments__", target_field: "comments" });
  return mappings;
}

function parseNotesSource(row: HubspotFieldRow | undefined): { engagements: boolean; custom_property: string | null } {
  if (!row?.hubspot_property) return { engagements: true, custom_property: null };
  const raw = String(row.hubspot_property).trim();
  try {
    const j = JSON.parse(raw);
    return {
      engagements: j?.engagements !== false,
      custom_property: typeof j?.custom_property === "string" && j.custom_property.trim() ? j.custom_property.trim() : null,
    };
  } catch {
    return { engagements: true, custom_property: null };
  }
}

export async function applyHubspotFieldMappingsToMappingSet(orgId: number): Promise<{ ok: boolean }> {
  try {
    const mappingSetId = await getOrCreateHubspotMappingSetId(orgId);
    if (!mappingSetId) return { ok: false };
    const rows = await loadHubspotFieldMappings(orgId);
    await replaceFieldMappings({ mappingSetId, mappings: buildIngestFieldMappings(rows) });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function loadHubspotFieldMappings(orgId: number): Promise<HubspotFieldRow[]> {
  const { rows } = await pool.query<HubspotFieldRow>(
    `
    SELECT sf_field, hubspot_property, confidence::text AS confidence
      FROM hubspot_field_mappings
     WHERE org_id = $1
       AND is_active IS TRUE
    `,
    [orgId]
  );
  return (rows || []) as HubspotFieldRow[];
}

type DealHubMeta = { hasBaseline: boolean; runCount: number };

async function loadDealMetaForHubIds(orgId: number, hubIds: string[]): Promise<Map<string, DealHubMeta>> {
  const map = new Map<string, DealHubMeta>();
  const ids = hubIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (!ids.length) return map;
  const { rows } = await pool.query<{
    crm_opp_id: string | null;
    has_baseline: boolean;
    run_count: string;
  }>(
    `
    SELECT NULLIF(btrim(COALESCE(crm_opp_id, '')), '') AS crm_opp_id,
           (baseline_health_score_ts IS NOT NULL) AS has_baseline,
           COALESCE(run_count, 0)::text AS run_count
      FROM opportunities
     WHERE org_id = $1
       AND NULLIF(btrim(COALESCE(crm_opp_id, '')), '') = ANY($2::text[])
    `,
    [orgId, ids]
  );
  for (const r of rows || []) {
    const id = String(r?.crm_opp_id || "").trim();
    if (!id) continue;
    map.set(id, { hasBaseline: !!r?.has_baseline, runCount: Number(r?.run_count) || 0 });
  }
  return map;
}

function mappedHubspotKey(rows: HubspotFieldRow[], sfField: string): string | null {
  const h = rows.find((r) => r.sf_field === sfField)?.hubspot_property;
  const s = String(h || "").trim();
  return s || null;
}

function mappedCell(raw: Record<string, unknown>, hubspotPropertyKey: string | null): string {
  if (!hubspotPropertyKey) return "";
  const v = raw[hubspotPropertyKey];
  return v == null ? "" : String(v).trim();
}

function normalizeDealRegistrationIngestValue(value: unknown): string | boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (normalized === "y" || normalized === "yes" || normalized === "true" || normalized === "1") return true;
  if (
    normalized === "n" ||
    normalized === "no" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "none" ||
    normalized === "null" ||
    normalized === "expired"
  ) {
    return false;
  }
  return raw;
}

function validateHubSpotIngestRow(args: {
  raw: Record<string, unknown>;
  mappingRows: HubspotFieldRow[];
  hubDealId: string;
}): { ok: true } | { ok: false; reason: string } {
  const { raw, mappingRows, hubDealId } = args;
  const crm = String(raw.__sf_crm_opp_id__ ?? "").trim();
  if (!crm) return { ok: false, reason: `missing crm_opp_id (hs_object_id) for deal ${hubDealId}` };
  const cdr = String(raw.__sf_create_date__ ?? "").trim();
  if (!cdr) return { ok: false, reason: `missing create_date (createdate) for deal ${hubDealId}` };
  if (!Number.isFinite(Date.parse(cdr))) return { ok: false, reason: `invalid create_date for deal ${hubDealId}` };

  for (const sf of ["deal_name", "amount", "close_date"] as const) {
    const k = mappedHubspotKey(mappingRows, sf);
    if (!k) return { ok: false, reason: `missing HubSpot mapping for ${sf} (deal ${hubDealId})` };
    if (!mappedCell(raw, k)) return { ok: false, reason: `missing value for ${sf} (deal ${hubDealId})` };
  }
  {
    const ownerKey = mappedHubspotKey(mappingRows, "owner");
    if (!ownerKey) return { ok: false, reason: `missing HubSpot mapping for owner (deal ${hubDealId})` };
    const resolved = String(raw.__sf_owner__ ?? "").trim();
    if (!resolved) return { ok: false, reason: `missing value for owner (deal ${hubDealId})` };
  }

  const stageKey = mappedHubspotKey(mappingRows, "stage");
  const fcKey = mappedHubspotKey(mappingRows, "forecast_stage");
  const stageVal = mappedCell(raw, stageKey);
  const fcVal = mappedCell(raw, fcKey);
  if (!stageVal && !fcVal) {
    return { ok: false, reason: `need sales stage or forecast stage (deal ${hubDealId})` };
  }
  return { ok: true };
}

async function appendSyncLogWarning(syncLogId: string, line: string): Promise<void> {
  const msg = String(line || "").trim();
  if (!msg) return;
  try {
    await pool.query(
      `
      UPDATE hubspot_sync_log
         SET error_text = CASE
           WHEN NULLIF(btrim(COALESCE(error_text, '')), '') IS NULL THEN $2
           ELSE error_text || chr(10) || $2
         END
       WHERE id = $1::uuid
      `,
      [syncLogId, msg]
    );
  } catch {
    /* best-effort */
  }
}

async function enqueueHubSpotCommentScoringJobs(args: {
  orgId: number;
  syncLogId: string;
  pageJobTag: number;
  rows: Array<{ crmOppId: string; rawText: string }>;
}): Promise<void> {
  const { orgId, syncLogId, pageJobTag, rows } = args;
  if (!rows.length) return;
  await new Promise((r) => setTimeout(r, 500));
  const queue = getIngestQueue();
  if (!queue || QUEUE_NAME !== "opportunity-ingest") return;
  const jobId = ["excel-comments", "hubspot", orgId, syncLogId, String(pageJobTag)].join("_");
  try {
    await queue.add(
      "excel-comments",
      {
        orgId,
        fileName: "hubspot-ingest",
        rows,
      },
      {
        jobId,
        attempts: 8,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch {
    /* enqueue best-effort */
  }
}

async function applyMetadataUpsert(args: {
  orgId: number;
  mappingSetId: string;
  rawRow: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const normRes = await pool.query<{ norm: any }>(
      `SELECT public.normalize_row($1::jsonb, $2::bigint) AS norm`,
      [JSON.stringify(args.rawRow), args.mappingSetId]
    );
    const norm = normRes.rows?.[0]?.norm;
    const valRes = await pool.query<{ err: string | null }>(`SELECT public.validate_row($1::jsonb, $2::int) AS err`, [
      norm,
      args.orgId,
    ]);
    const err = valRes.rows?.[0]?.err;
    if (err) return { ok: false, error: String(err) };
    await pool.query(`SELECT public.upsert_opportunity($1::jsonb, $2::int)`, [norm, args.orgId]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function buildRawRowForDeal(args: {
  orgId: number;
  deal: HubSpotDealWithCompany;
  mappingRows: HubspotFieldRow[];
  notesSource: { engagements: boolean; custom_property: string | null };
  ownerMap: Map<string, string>;
  syncLogId?: string | null;
}): Promise<Record<string, unknown>> {
  const { deal, mappingRows, notesSource, orgId, ownerMap, syncLogId } = args;
  const props = deal.properties || {};
  const row: Record<string, unknown> = {};

  for (const m of mappingRows) {
    if (m.sf_field === "notes_source") continue;
    const src = String(m.hubspot_property || "").trim();
    if (!src) continue;
    const v = props[src];
    if (m.sf_field === "deal_reg") {
      row[src] = normalizeDealRegistrationIngestValue(v);
      continue;
    }
    row[src] = v == null ? "" : String(v);
  }

  const cd = props["createdate"] ?? props["hs_createdate"];
  row.__sf_crm_opp_id__ = String(props["hs_object_id"] ?? "").trim() || String(deal.id ?? "").trim();
  row.__sf_create_date__ = cd == null ? "" : String(cd);

  const ownerId = String(props["hubspot_owner_id"] ?? "").trim();
  const ownerEmail = ownerId ? String(ownerMap.get(ownerId) ?? "").trim() : "";
  if (ownerId && !ownerEmail && syncLogId) {
    await appendSyncLogWarning(
      syncLogId,
      `Could not resolve HubSpot owner id ${ownerId} to an email for deal ${deal.id}`
    );
  }
  row.__sf_owner__ = ownerEmail;
  const ownerSrc = mappingRows.find((r) => r.sf_field === "owner")?.hubspot_property;
  if (ownerSrc) {
    row[String(ownerSrc)] = ownerEmail;
  }

  const parts: string[] = [];
  if (notesSource.engagements) {
    const eng = await getDealEngagements(orgId, deal.id);
    if (eng.ok) {
      for (const e of eng.data) {
        const t = String(e.body || "").trim();
        if (t) parts.push(t);
      }
    }
  }
  if (notesSource.custom_property) {
    const cp = notesSource.custom_property;
    const extra = props[cp];
    const t = extra == null ? "" : String(extra).trim();
    if (t) parts.push(t);
  }
  row.__sf_comments__ = parts.join("\n\n---\n\n");

  row.__sf_company_name__ = deal.company_name == null ? "" : String(deal.company_name);

  return row;
}

async function updateSyncLog(
  syncLogId: string,
  patch: Partial<{
    status: string;
    deals_fetched: number;
    deals_upserted: number;
    deals_scored: number;
    error_text: string | null;
    completed_at: string | null;
  }>
) {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 0;
  if (patch.status != null) {
    sets.push(`status = $${++i}`);
    vals.push(patch.status);
  }
  if (patch.deals_fetched != null) {
    sets.push(`deals_fetched = COALESCE(deals_fetched,0) + $${++i}`);
    vals.push(patch.deals_fetched);
  }
  if (patch.deals_upserted != null) {
    sets.push(`deals_upserted = COALESCE(deals_upserted,0) + $${++i}`);
    vals.push(patch.deals_upserted);
  }
  if (patch.deals_scored != null) {
    sets.push(`deals_scored = COALESCE(deals_scored,0) + $${++i}`);
    vals.push(patch.deals_scored);
  }
  if (patch.error_text !== undefined) {
    sets.push(`error_text = $${++i}`);
    vals.push(patch.error_text);
  }
  if (patch.completed_at !== undefined) {
    sets.push(`completed_at = $${++i}`);
    vals.push(patch.completed_at);
  }
  if (!sets.length) return;
  vals.push(syncLogId);
  await pool.query(`UPDATE hubspot_sync_log SET ${sets.join(", ")} WHERE id = $${++i}::uuid`, vals);
}

export async function runHubSpotIngest(params: {
  orgId: number;
  syncLogId: string;
  syncType: "initial" | "scheduled" | "manual";
}): Promise<void> {
  const { orgId, syncLogId, syncType } = params;
  try {
    await updateSyncLog(syncLogId, { status: "running", error_text: null });

    const mappingRows = await loadHubspotFieldMappings(orgId);
    const notesSource = parseNotesSource(mappingRows.find((r) => r.sf_field === "notes_source"));
    const mappingSetId = await getOrCreateHubspotMappingSetId(orgId);
    if (!mappingSetId) {
      await updateSyncLog(syncLogId, { status: "failed", error_text: "Missing HubSpot mapping set", completed_at: new Date().toISOString() });
      return;
    }

    const ingestMappings = buildIngestFieldMappings(mappingRows);
    await replaceFieldMappings({ mappingSetId, mappings: ingestMappings });

    const { after, before } = getHubspotScoringCloseDateBounds();
    const extraProps = mappingRows
      .filter((r) => !["company_name", "crm_opp_id", "create_date"].includes(r.sf_field))
      .map((r) => String(r.hubspot_property || "").trim())
      .filter((p) => p && p !== "notes_source" && !p.startsWith("{"));

    const ownerMap = new Map<string, string>();
    const ownersRes = await getOwners(orgId);
    if (ownersRes.ok === false) {
      await appendSyncLogWarning(
        syncLogId,
        `HubSpot owners list failed (${ownersRes.error}) — owner resolution may skip deals`
      );
    } else {
      for (const o of ownersRes.data) {
        if (o.id && o.email) ownerMap.set(o.id, o.email);
      }
    }

    let cursor: string | undefined;
    let totalProcessed = 0;
    do {
      const pageJobTag = totalProcessed;
      const page = await getDealsWithCompanies(orgId, {
        after: cursor,
        limit: 100,
        closeDateAfter: after,
        closeDateBefore: before,
        extraProperties: extraProps,
      });
      if (page.ok === false) {
        await updateSyncLog(syncLogId, {
          status: "failed",
          error_text: page.error,
          completed_at: new Date().toISOString(),
        });
        return;
      }

      const deals = page.data.deals;
      await updateSyncLog(syncLogId, { deals_fetched: deals.length });

      const hubIds = deals.map((d) => String(d.id || "").trim()).filter(Boolean);
      const dealMeta = await loadDealMetaForHubIds(orgId, hubIds);

      const newRows: Record<string, unknown>[] = [];
      const excelRows: Array<{ crmOppId: string; rawText: string }> = [];

      for (const deal of deals) {
        const crmId = String(deal.id || "").trim();
        if (!crmId) continue;

        const raw = await buildRawRowForDeal({
          orgId,
          deal,
          mappingRows,
          notesSource,
          ownerMap,
          syncLogId,
        });

        const v = validateHubSpotIngestRow({ raw, mappingRows, hubDealId: crmId });
        if (v.ok === false) {
          await appendSyncLogWarning(syncLogId, `Skipping deal ${crmId}: ${v.reason}`);
          continue;
        }

        const comments = String(raw.__sf_comments__ || "").trim();
        if (!comments) {
          await appendSyncLogWarning(syncLogId, `no notes found for deal ${crmId} — ingested without baseline score`);
        }

        const meta = dealMeta.get(crmId);
        const hasBaseline = !!(meta?.hasBaseline || (meta?.runCount ?? 0) > 0);
        const existsInDb = !!meta;

        if (existsInDb && hasBaseline) {
          const up = await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
          if (up.ok) await updateSyncLog(syncLogId, { deals_upserted: 1 });
        } else if (existsInDb && !hasBaseline && syncType === "manual") {
          const up = await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
          if (up.ok) await updateSyncLog(syncLogId, { deals_upserted: 1 });
          if (comments) excelRows.push({ crmOppId: crmId, rawText: comments });
        } else {
          newRows.push(raw);
          if (comments) excelRows.push({ crmOppId: crmId, rawText: comments });
        }
      }

      if (newRows.length) {
        await stageIngestionRows({
          organizationId: orgId,
          mappingSetId,
          rawRows: newRows,
        });
        const summary = await processIngestionBatch({ organizationId: orgId, mappingSetId });
        const processed = Number(summary?.processed || 0) || 0;
        await updateSyncLog(syncLogId, { deals_upserted: processed, deals_scored: processed });
      }

      if (excelRows.length) {
        await enqueueHubSpotCommentScoringJobs({
          orgId,
          syncLogId,
          pageJobTag,
          rows: excelRows,
        });
      }

      totalProcessed += deals.length;
      cursor = page.data.nextCursor || undefined;
    } while (cursor);

    await pool.query(`UPDATE hubspot_connections SET last_synced_at = now(), updated_at = now() WHERE org_id = $1`, [orgId]);
    await updateSyncLog(syncLogId, { status: "completed", completed_at: new Date().toISOString() });
  } catch (e: any) {
    await updateSyncLog(syncLogId, {
      status: "failed",
      error_text: e?.message || String(e),
      completed_at: new Date().toISOString(),
    });
  }
}

export async function syncHubSpotDealMetadataOnly(args: { orgId: number; dealId: string }): Promise<void> {
  const { orgId, dealId } = args;
  try {
    const { after, before } = getHubspotScoringCloseDateBounds();
    const mappingRows = await loadHubspotFieldMappings(orgId);
    const notesSource = parseNotesSource(mappingRows.find((r) => r.sf_field === "notes_source"));
    const mappingSetId = await getOrCreateHubspotMappingSetId(orgId);
    if (!mappingSetId) return;
    const ingestMappings = buildIngestFieldMappings(mappingRows);
    await replaceFieldMappings({ mappingSetId, mappings: ingestMappings });

    const extraProps = mappingRows
      .filter((r) => !["company_name", "crm_opp_id", "create_date"].includes(r.sf_field))
      .map((r) => String(r.hubspot_property || "").trim())
      .filter((p) => p && p !== "notes_source" && !p.startsWith("{"));
    const dealRes = await getDealByIdWithCompany(orgId, dealId, extraProps);
    if (dealRes.ok === false || !dealRes.data) return;
    const closeRaw = dealRes.data.properties?.closedate ?? dealRes.data.properties?.hs_closedate;
    if (closeRaw) {
      const cd = new Date(String(closeRaw));
      if (Number.isFinite(cd.getTime()) && (cd.getTime() < after.getTime() || cd.getTime() >= before.getTime())) {
        return;
      }
    }

    const ownerMap = new Map<string, string>();
    const ownersRes = await getOwners(orgId);
    if (ownersRes.ok) {
      for (const o of ownersRes.data) {
        if (o.id && o.email) ownerMap.set(o.id, o.email);
      }
    }
    const raw = await buildRawRowForDeal({
      orgId,
      deal: dealRes.data,
      mappingRows,
      notesSource,
      ownerMap,
    });
    await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
  } catch {
    /* never throw from worker */
  }
}

export async function markHubSpotDealDeleted(args: { orgId: number; dealId: string }): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE opportunities
         SET predictive_eligible = false,
             updated_at = now()
       WHERE org_id = $1
         AND NULLIF(btrim(COALESCE(crm_opp_id, '')), '') = $2
      `,
      [args.orgId, String(args.dealId || "").trim()]
    );
  } catch {
    /* soft-delete best-effort */
  }
}
