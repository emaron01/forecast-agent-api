import { pool } from "./pool";
import {
  createFieldMappingSet,
  processIngestionBatch,
  replaceFieldMappings,
  stageIngestionRows,
} from "./db";
import {
  getOpportunitiesWithAccounts,
  getOpportunityById,
  getOwners,
  type SalesforceOpportunityWithAccount,
} from "./salesforceClient";
import { getIngestQueue, QUEUE_NAME } from "./ingest-queue";

// ---------------------------------------------------------------------------
// Close date window — mirrors getHubspotScoringCloseDateBounds exactly
// ---------------------------------------------------------------------------

export function getSalesforceScoringCloseDateBounds(): { after: Date; before: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const qStartMonth = Math.floor(m / 3) * 3;
  const currentQuarterStart = new Date(Date.UTC(y, qStartMonth, 1));
  const after = new Date(
    Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() - 6, 1)
  );
  const before = new Date(
    Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() + 6, 1)
  );
  return { after, before };
}

// ---------------------------------------------------------------------------
// Field mapping — mirrors hubspotIngest SF_TO_TARGET pattern
// Canonical sf_field → internal opportunities column target
// ---------------------------------------------------------------------------

const SF_TO_TARGET: Record<string, string> = {
  deal_name:      "opportunity_name",
  amount:         "amount",
  close_date:     "close_date",
  stage:          "sales_stage",
  owner:          "rep_name",
  forecast_stage: "forecast_stage",
  product:        "product",
  partner_name:   "partner_name",
  deal_reg:       "deal_registration",
  deal_reg_date:  "deal_reg_date",
  deal_reg_id:    "deal_reg_id",
};

// Default SFDC Opportunity field → canonical sf_field mappings
// These are used when no custom field mapping has been configured by the org.
const DEFAULT_SFDC_FIELD_MAP: Record<string, string> = {
  deal_name:      "Name",
  amount:         "Amount",
  close_date:     "CloseDate",
  stage:          "StageName",
  owner:          "OwnerId",
  forecast_stage: "ForecastCategoryName",
};

type SalesforceFieldRow = {
  sf_field: string;
  sfdc_api_name: string | null;
  confidence: string | null;
};

// ---------------------------------------------------------------------------
// Mapping set helpers — mirrors hubspotIngest exactly
// ---------------------------------------------------------------------------

async function getOrCreateSalesforceMappingSetId(orgId: number): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `
      SELECT id::text AS id
        FROM field_mapping_sets
       WHERE organization_id = $1
         AND source_system = 'salesforce'
       ORDER BY id ASC
       LIMIT 1
      `,
      [orgId]
    );
    if (rows?.[0]?.id) return rows[0].id;
    const created = await createFieldMappingSet({
      organizationId: orgId,
      name: "Salesforce",
      source_system: "salesforce",
    });
    return created?.id || null;
  } catch {
    return null;
  }
}

function buildIngestFieldMappings(rows: SalesforceFieldRow[]) {
  const mappings: Array<{ source_field: string; target_field: string }> = [];
  const skipSf = new Set(["notes_source", "company_name", "crm_opp_id", "create_date"]);
  for (const r of rows) {
    if (!r || skipSf.has(r.sf_field)) continue;
    const tgt = SF_TO_TARGET[r.sf_field];
    const src = String(r.sfdc_api_name || DEFAULT_SFDC_FIELD_MAP[r.sf_field] || "").trim();
    if (!tgt || !src) continue;
    mappings.push({ source_field: src, target_field: tgt });
  }
  mappings.push({ source_field: "__sf_company_name__", target_field: "account_name" });
  mappings.push({ source_field: "__sf_crm_opp_id__",   target_field: "crm_opp_id" });
  mappings.push({ source_field: "__sf_create_date__",  target_field: "create_date_raw" });
  mappings.push({ source_field: "__sf_comments__",     target_field: "comments" });
  return mappings;
}

async function loadSalesforceFieldMappings(orgId: number): Promise<SalesforceFieldRow[]> {
  const { rows } = await pool.query<SalesforceFieldRow>(
    `
    SELECT sf_field, sfdc_api_name, confidence::text AS confidence
      FROM salesforce_field_mappings
     WHERE org_id = $1
       AND is_active IS TRUE
    `,
    [orgId]
  );
  // If no custom mappings configured yet, seed defaults so ingest can proceed
  if (!rows || rows.length === 0) {
    return Object.entries(DEFAULT_SFDC_FIELD_MAP).map(([sf_field, sfdc_api_name]) => ({
      sf_field,
      sfdc_api_name,
      confidence: "high",
    }));
  }
  return rows as SalesforceFieldRow[];
}

// ---------------------------------------------------------------------------
// Opportunity meta cache — mirrors loadDealMetaForHubIds
// ---------------------------------------------------------------------------

type OppSalesforceMeta = { hasBaseline: boolean; runCount: number };

async function loadOppMetaForSalesforceIds(
  orgId: number,
  sfIds: string[]
): Promise<Map<string, OppSalesforceMeta>> {
  const map = new Map<string, OppSalesforceMeta>();
  const ids = sfIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (!ids.length) return map;
  const { rows } = await pool.query<{
    crm_opp_id: string | null;
    has_baseline: boolean;
    run_count: string;
  }>(
    `
    SELECT NULLIF(btrim(COALESCE(crm_opp_id, '')), '') AS crm_opp_id,
           (baseline_health_score_ts IS NOT NULL)       AS has_baseline,
           COALESCE(run_count, 0)::text                 AS run_count
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

// ---------------------------------------------------------------------------
// Raw row builder — mirrors buildRawRowForDeal
// Notes: fetched from Salesforce ActivityHistory/Task via SOQL
// ---------------------------------------------------------------------------

async function fetchOpportunityNotes(orgId: number, opportunityId: string): Promise<string> {
  // Fetch Task records related to this Opportunity (calls, emails, notes)
  // Uses a sub-select on ActivityHistories which is available on Opportunity
  const { rows } = await pool.query<{ instance_url: string; api_version: string }>(
    `SELECT instance_url, api_version FROM salesforce_connections WHERE org_id = $1 LIMIT 1`,
    [orgId]
  );
  const conn = rows?.[0];
  if (!conn) return "";

  // Import lazily to avoid circular dep — sfAuthorizedJson is internal to salesforceClient
  // Instead we re-use getOpportunityById to fetch the Description field as a notes proxy
  // Full ActivityHistory integration is a Phase 2 enhancement
  const descRes = await getOpportunityById(orgId, opportunityId, ["Description"]);
  if (descRes.ok === false || !descRes.data) return "";
  const desc = String(descRes.data.properties["Description"] ?? "").trim();
  return desc;
}

function mappedSfdcField(rows: SalesforceFieldRow[], sfField: string): string | null {
  const found = rows.find((r) => r.sf_field === sfField);
  const apiName = String(found?.sfdc_api_name || DEFAULT_SFDC_FIELD_MAP[sfField] || "").trim();
  return apiName || null;
}

function mappedCell(props: Record<string, string>, apiName: string | null): string {
  if (!apiName) return "";
  const v = props[apiName];
  return v == null ? "" : String(v).trim();
}

async function buildRawRowForOpportunity(args: {
  orgId: number;
  opp: SalesforceOpportunityWithAccount;
  mappingRows: SalesforceFieldRow[];
  ownerMap: Map<string, string>;
  syncLogId?: string | null;
}): Promise<Record<string, unknown>> {
  const { opp, mappingRows, orgId, ownerMap } = args;
  const props = opp.properties || {};
  const row: Record<string, unknown> = {};

  for (const m of mappingRows) {
    if (m.sf_field === "notes_source") continue;
    const src = String(m.sfdc_api_name || DEFAULT_SFDC_FIELD_MAP[m.sf_field] || "").trim();
    if (!src) continue;
    const v = props[src];
    row[src] = v == null ? "" : String(v);
  }

  row.__sf_crm_opp_id__  = String(props["Id"] ?? "").trim() || String(opp.id ?? "").trim();
  row.__sf_create_date__ = String(props["CreatedDate"] ?? "").trim();
  row.__sf_company_name__ = opp.account_name == null ? "" : String(opp.account_name);

  // Resolve owner email from OwnerId
  const ownerId = String(props["OwnerId"] ?? "").trim();
  const ownerEmail = ownerId ? String(ownerMap.get(ownerId) ?? "").trim() : "";
  row.__sf_owner__ = ownerEmail;
  const ownerSrc = mappedSfdcField(mappingRows, "owner");
  if (ownerSrc) row[ownerSrc] = ownerEmail;

  // Fetch notes (Description field as Phase 1 proxy; full ActivityHistory in Phase 2)
  const notes = await fetchOpportunityNotes(orgId, opp.id);
  row.__sf_comments__ = notes;

  return row;
}

// ---------------------------------------------------------------------------
// Validation — mirrors validateHubSpotIngestRow
// ---------------------------------------------------------------------------

function validateSalesforceIngestRow(args: {
  raw: Record<string, unknown>;
  mappingRows: SalesforceFieldRow[];
  sfOppId: string;
}): { ok: true } | { ok: false; reason: string } {
  const { raw, mappingRows, sfOppId } = args;

  const crm = String(raw.__sf_crm_opp_id__ ?? "").trim();
  if (!crm) return { ok: false, reason: `missing crm_opp_id (Id) for opportunity ${sfOppId}` };

  const cdr = String(raw.__sf_create_date__ ?? "").trim();
  if (!cdr) return { ok: false, reason: `missing create_date (CreatedDate) for opportunity ${sfOppId}` };
  if (!Number.isFinite(Date.parse(cdr))) {
    return { ok: false, reason: `invalid create_date for opportunity ${sfOppId}` };
  }

  for (const sf of ["deal_name", "amount", "close_date"] as const) {
    const k = mappedSfdcField(mappingRows, sf);
    if (!k) return { ok: false, reason: `missing Salesforce mapping for ${sf} (opportunity ${sfOppId})` };
    if (!mappedCell(raw as Record<string, string>, k)) {
      return { ok: false, reason: `missing value for ${sf} (opportunity ${sfOppId})` };
    }
  }

  const ownerVal = String(raw.__sf_owner__ ?? "").trim();
  if (!ownerVal) {
    return { ok: false, reason: `missing owner email for opportunity ${sfOppId}` };
  }

  const stageKey = mappedSfdcField(mappingRows, "stage");
  const fcKey    = mappedSfdcField(mappingRows, "forecast_stage");
  const stageVal = mappedCell(raw as Record<string, string>, stageKey);
  const fcVal    = mappedCell(raw as Record<string, string>, fcKey);
  if (!stageVal && !fcVal) {
    return { ok: false, reason: `need StageName or ForecastCategoryName (opportunity ${sfOppId})` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sync log helpers — mirrors hubspotIngest updateSyncLog / appendSyncLogWarning
// ---------------------------------------------------------------------------

async function updateSyncLog(
  syncLogId: string,
  patch: Partial<{
    status: string;
    opportunities_fetched: number;
    opportunities_upserted: number;
    opportunities_scored: number;
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
  if (patch.opportunities_fetched != null) {
    sets.push(`opportunities_fetched = COALESCE(opportunities_fetched,0) + $${++i}`);
    vals.push(patch.opportunities_fetched);
  }
  if (patch.opportunities_upserted != null) {
    sets.push(`opportunities_upserted = COALESCE(opportunities_upserted,0) + $${++i}`);
    vals.push(patch.opportunities_upserted);
  }
  if (patch.opportunities_scored != null) {
    sets.push(`opportunities_scored = COALESCE(opportunities_scored,0) + $${++i}`);
    vals.push(patch.opportunities_scored);
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
  await pool.query(
    `UPDATE salesforce_sync_log SET ${sets.join(", ")} WHERE id = $${++i}::uuid`,
    vals
  );
}

async function appendSyncLogWarning(syncLogId: string, line: string): Promise<void> {
  const msg = String(line || "").trim();
  if (!msg) return;
  try {
    await pool.query(
      `
      UPDATE salesforce_sync_log
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

async function appendSyncLogInfo(syncLogId: string, line: string): Promise<void> {
  await pool.query(
    `UPDATE salesforce_sync_log
        SET error_text = CASE
          WHEN error_text IS NULL THEN $2
          ELSE error_text || E'\n' || $2
        END
      WHERE id = $1`,
    [syncLogId, line]
  );
}

// ---------------------------------------------------------------------------
// Comment scoring job enqueue — mirrors enqueueHubSpotCommentScoringJobs
// ---------------------------------------------------------------------------

async function enqueueSalesforceCommentScoringJobs(args: {
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
  const jobId = ["excel-comments", "salesforce", orgId, syncLogId, String(pageJobTag)].join("_");
  try {
    await queue.add(
      "excel-comments",
      { orgId, fileName: "salesforce-ingest", rows },
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

// ---------------------------------------------------------------------------
// Metadata upsert — identical to hubspotIngest applyMetadataUpsert
// ---------------------------------------------------------------------------

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
    const valRes = await pool.query<{ err: string | null }>(
      `SELECT public.validate_row($1::jsonb, $2::int) AS err`,
      [norm, args.orgId]
    );
    const err = valRes.rows?.[0]?.err;
    if (err) return { ok: false, error: String(err) };
    await pool.query(`SELECT public.upsert_opportunity($1::jsonb, $2::int)`, [norm, args.orgId]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---------------------------------------------------------------------------
// Scheduled sync enqueue — mirrors enqueueScheduledHubSpotSyncs
// ---------------------------------------------------------------------------

export async function enqueueScheduledSalesforceSyncs(): Promise<{
  ok: true;
  orgs_queued: number;
  orgs_skipped: number;
}> {
  const queue = getIngestQueue();
  if (!queue) return { ok: true, orgs_queued: 0, orgs_skipped: 0 };

  const { rows } = await pool.query<{ org_id: string }>(
    `
    SELECT org_id::text AS org_id
      FROM salesforce_connections
     WHERE access_token_enc IS NOT NULL
    `
  );

  let orgsQueued = 0;
  let orgsSkipped = 0;

  for (const row of rows) {
    const orgId = Number(row.org_id || 0);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      orgsSkipped++;
      continue;
    }

    const inFlight = await pool.query(
      `
      SELECT 1
        FROM salesforce_sync_log
       WHERE org_id = $1
         AND status IN ('pending', 'running')
         AND started_at > now() - interval '30 minutes'
       LIMIT 1
      `,
      [orgId]
    );
    if (inFlight.rows.length) {
      orgsSkipped++;
      continue;
    }

    let syncLogId = "";
    try {
      const ins = await pool.query<{ id: string }>(
        `
        INSERT INTO salesforce_sync_log (org_id, sync_type, status)
        VALUES ($1, 'scheduled', 'pending')
        RETURNING id::text AS id
        `,
        [orgId]
      );
      syncLogId = String(ins.rows[0]?.id || "").trim();
      if (!syncLogId) { orgsSkipped++; continue; }

      await queue.add(
        "salesforce-initial-sync",
        { orgId, syncLogId, syncType: "scheduled", crm: "salesforce" },
        {
          jobId: `salesforce-scheduled-sync_${orgId}_${Date.now()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      orgsQueued++;
    } catch (e: any) {
      if (syncLogId) {
        await pool.query(
          `UPDATE salesforce_sync_log SET status = 'failed', error_text = $2, completed_at = now() WHERE id = $1::uuid`,
          [syncLogId, e?.message || String(e)]
        );
      }
      orgsSkipped++;
    }
  }

  return { ok: true, orgs_queued: orgsQueued, orgs_skipped: orgsSkipped };
}

// ---------------------------------------------------------------------------
// Main ingest — mirrors runHubSpotIngest exactly
// ---------------------------------------------------------------------------

export async function runSalesforceIngest(params: {
  orgId: number;
  syncLogId: string;
  syncType: "initial" | "scheduled" | "manual";
}): Promise<void> {
  const { orgId, syncLogId, syncType } = params;
  try {
    await updateSyncLog(syncLogId, { status: "running", error_text: null });

    const mappingRows = await loadSalesforceFieldMappings(orgId);
    const mappingSetId = await getOrCreateSalesforceMappingSetId(orgId);
    if (!mappingSetId) {
      await updateSyncLog(syncLogId, {
        status: "failed",
        error_text: "Missing Salesforce mapping set",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const ingestMappings = buildIngestFieldMappings(mappingRows);
    await replaceFieldMappings({ mappingSetId, mappings: ingestMappings });

    const { after, before } = getSalesforceScoringCloseDateBounds();

    const extraFields = mappingRows
      .filter((r) => !["company_name", "crm_opp_id", "create_date", "notes_source"].includes(r.sf_field))
      .map((r) => String(r.sfdc_api_name || DEFAULT_SFDC_FIELD_MAP[r.sf_field] || "").trim())
      .filter(Boolean);

    // Build owner map: OwnerId → email
    const ownerMap = new Map<string, string>();
    const ownersRes = await getOwners(orgId);
    if (ownersRes.ok === false) {
      await appendSyncLogWarning(
        syncLogId,
        `Salesforce users list failed (${ownersRes.error}) — owner resolution may skip opportunities`
      );
    } else {
      for (const o of ownersRes.data) {
        if (o.id && o.email) ownerMap.set(o.id, o.email);
      }
    }

    let nextUrl: string | null = null;
    let totalProcessed = 0;

    do {
      const pageJobTag = totalProcessed;
      const page = await getOpportunitiesWithAccounts(orgId, {
        closeDateAfter: after,
        closeDateBefore: before,
        extraFields,
        nextUrl: nextUrl || undefined,
      });

      if (page.ok === false) {
        await updateSyncLog(syncLogId, {
          status: "failed",
          error_text: page.error,
          completed_at: new Date().toISOString(),
        });
        return;
      }

      const opps = page.data.opportunities;
      await updateSyncLog(syncLogId, { opportunities_fetched: opps.length });

      const sfIds = opps.map((o) => String(o.id || "").trim()).filter(Boolean);
      const oppMeta = await loadOppMetaForSalesforceIds(orgId, sfIds);

      const newRows: Record<string, unknown>[] = [];
      const commentRows: Array<{ crmOppId: string; rawText: string }> = [];
      let newOppsScored  = 0;
      let newOppsNoNotes = 0;
      let oppsUpdated    = 0;

      for (const opp of opps) {
        const crmId = String(opp.id || "").trim();
        if (!crmId) continue;

        const raw = await buildRawRowForOpportunity({
          orgId,
          opp,
          mappingRows,
          ownerMap,
          syncLogId,
        });

        const v = validateSalesforceIngestRow({ raw, mappingRows, sfOppId: crmId });
        if (v.ok === false) {
          await appendSyncLogWarning(syncLogId, `Skipping opportunity ${crmId}: ${v.reason}`);
          continue;
        }

        const comments = String(raw.__sf_comments__ || "").trim();
        const meta      = oppMeta.get(crmId);
        const hasBaseline = !!(meta?.hasBaseline || (meta?.runCount ?? 0) > 0);
        const existsInDb  = !!meta;

        if (existsInDb && hasBaseline) {
          const up = await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
          if (up.ok) await updateSyncLog(syncLogId, { opportunities_upserted: 1 });
          oppsUpdated++;
        } else if (existsInDb && !hasBaseline && syncType === "manual") {
          const up = await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
          if (up.ok) await updateSyncLog(syncLogId, { opportunities_upserted: 1 });
          oppsUpdated++;
          if (comments) newOppsScored++; else newOppsNoNotes++;
          if (comments) commentRows.push({ crmOppId: crmId, rawText: comments });
        } else {
          newRows.push(raw);
          if (comments) newOppsScored++; else newOppsNoNotes++;
          if (comments) commentRows.push({ crmOppId: crmId, rawText: comments });
        }
      }

      const parts: string[] = [];
      if (newOppsScored  > 0) parts.push(`${newOppsScored} new opportunity(s) scored from Salesforce notes`);
      if (oppsUpdated    > 0) parts.push(`${oppsUpdated} opportunity(s) updated`);
      if (newOppsNoNotes > 0) parts.push(`${newOppsNoNotes} opportunity(s) had no notes — Matthew will score these during rep reviews`);
      if (parts.length   > 0) await appendSyncLogInfo(syncLogId, parts.join(" · "));

      if (newRows.length) {
        await stageIngestionRows({ organizationId: orgId, mappingSetId, rawRows: newRows });
        const summary   = await processIngestionBatch({ organizationId: orgId, mappingSetId });
        const processed = Number(summary?.processed || 0) || 0;
        await updateSyncLog(syncLogId, {
          opportunities_upserted: processed,
          opportunities_scored:   processed,
        });
      }

      if (commentRows.length) {
        await enqueueSalesforceCommentScoringJobs({
          orgId,
          syncLogId,
          pageJobTag,
          rows: commentRows,
        });
      }

      totalProcessed += opps.length;
      nextUrl = page.data.nextUrl;
    } while (nextUrl);

    await pool.query(
      `UPDATE salesforce_connections SET last_synced_at = now(), updated_at = now() WHERE org_id = $1`,
      [orgId]
    );
    await updateSyncLog(syncLogId, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
  } catch (e: any) {
    await updateSyncLog(syncLogId, {
      status: "failed",
      error_text: e?.message || String(e),
      completed_at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Single opportunity metadata sync — mirrors syncHubSpotDealMetadataOnly
// ---------------------------------------------------------------------------

export async function syncSalesforceOpportunityMetadataOnly(args: {
  orgId: number;
  opportunityId: string;
}): Promise<void> {
  const { orgId, opportunityId } = args;
  try {
    const { after, before } = getSalesforceScoringCloseDateBounds();
    const mappingRows  = await loadSalesforceFieldMappings(orgId);
    const mappingSetId = await getOrCreateSalesforceMappingSetId(orgId);
    if (!mappingSetId) return;

    const ingestMappings = buildIngestFieldMappings(mappingRows);
    await replaceFieldMappings({ mappingSetId, mappings: ingestMappings });

    const extraFields = mappingRows
      .filter((r) => !["company_name", "crm_opp_id", "create_date", "notes_source"].includes(r.sf_field))
      .map((r) => String(r.sfdc_api_name || DEFAULT_SFDC_FIELD_MAP[r.sf_field] || "").trim())
      .filter(Boolean);

    const oppRes = await getOpportunityById(orgId, opportunityId, extraFields);
    if (oppRes.ok === false || !oppRes.data) return;

    const closeRaw = oppRes.data.properties["CloseDate"];
    if (closeRaw) {
      const cd = new Date(String(closeRaw));
      if (
        Number.isFinite(cd.getTime()) &&
        (cd.getTime() < after.getTime() || cd.getTime() >= before.getTime())
      ) return;
    }

    const ownerMap = new Map<string, string>();
    const ownersRes = await getOwners(orgId);
    if (ownersRes.ok) {
      for (const o of ownersRes.data) {
        if (o.id && o.email) ownerMap.set(o.id, o.email);
      }
    }

    const oppWithAccount: SalesforceOpportunityWithAccount = {
      id: oppRes.data.id,
      properties: Object.fromEntries(
        Object.entries(oppRes.data.properties).map(([k, v]) => [k, v == null ? "" : String(v)])
      ),
      account_name: null,
    };

    const raw = await buildRawRowForOpportunity({
      orgId,
      opp: oppWithAccount,
      mappingRows,
      ownerMap,
    });

    await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
  } catch {
    /* never throw from worker */
  }
}
