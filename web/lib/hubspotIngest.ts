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
  getOwnerEmailOrName,
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
  stage: "forecast_stage",
  owner: "rep_name",
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
  for (const r of rows) {
    if (!r || r.sf_field === "notes_source" || r.sf_field === "company_name") continue;
    const tgt = SF_TO_TARGET[r.sf_field];
    const src = String(r.hubspot_property || "").trim();
    if (!tgt || !src) continue;
    mappings.push({ source_field: src, target_field: tgt });
  }
  mappings.push({ source_field: "__sf_company_name__", target_field: "account_name" });
  mappings.push({ source_field: "__hs_deal_id__", target_field: "crm_opp_id" });
  mappings.push({ source_field: "createdate", target_field: "create_date_raw" });
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

async function loadExistingCrmMeta(orgId: number): Promise<Set<string>> {
  const { rows } = await pool.query<{ crm_opp_id: string | null }>(
    `
    SELECT NULLIF(btrim(COALESCE(crm_opp_id, '')), '') AS crm_opp_id
      FROM opportunities
     WHERE org_id = $1
       AND (
         baseline_health_score_ts IS NOT NULL
         OR COALESCE(run_count, 0) > 0
       )
    `,
    [orgId]
  );
  const s = new Set<string>();
  for (const r of rows || []) {
    const id = String(r?.crm_opp_id || "").trim();
    if (id) s.add(id);
  }
  return s;
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
  ownerCache: Map<string, string>;
}): Promise<Record<string, unknown>> {
  const { deal, mappingRows, notesSource, orgId, ownerCache } = args;
  const props = deal.properties || {};
  const row: Record<string, unknown> = {};

  for (const m of mappingRows) {
    if (m.sf_field === "notes_source") continue;
    const src = String(m.hubspot_property || "").trim();
    if (!src) continue;
    const v = props[src];
    row[src] = v == null ? "" : String(v);
  }

  row.__hs_deal_id__ = deal.id;
  const cd = props["createdate"] ?? props["hs_createdate"];
  row["createdate"] = cd == null ? new Date().toISOString() : String(cd);

  const ownerId = String(props["hubspot_owner_id"] ?? "").trim();
  if (ownerId) {
    let rep = ownerCache.get(ownerId);
    if (rep == null) {
      const resolved = await getOwnerEmailOrName(orgId, ownerId);
      rep = resolved.ok ? resolved.data : "";
      ownerCache.set(ownerId, rep);
    }
    const ownerSrc = mappingRows.find((r) => r.sf_field === "owner")?.hubspot_property;
    if (ownerSrc && row[ownerSrc] == null) {
      row[String(ownerSrc)] = rep || ownerId;
    } else if (ownerSrc) {
      row[String(ownerSrc)] = String(row[String(ownerSrc)] || rep || ownerId);
    }
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
  const ownerCache = new Map<string, string>();
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
      .filter((r) => r.sf_field !== "company_name")
      .map((r) => String(r.hubspot_property || "").trim())
      .filter((p) => p && p !== "notes_source" && !p.startsWith("{"));

    const existingMeta = await loadExistingCrmMeta(orgId);

    let cursor: string | undefined;
    let totalProcessed = 0;
    do {
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

      const newRows: Record<string, unknown>[] = [];
      const excelRows: Array<{ crmOppId: string; rawText: string }> = [];

      for (const deal of deals) {
        const raw = await buildRawRowForDeal({
          orgId,
          deal,
          mappingRows,
          notesSource,
          ownerCache,
        });
        const crmId = String(deal.id || "").trim();
        if (!crmId) continue;

        if (existingMeta.has(crmId)) {
          const up = await applyMetadataUpsert({ orgId, mappingSetId, rawRow: raw });
          if (up.ok) await updateSyncLog(syncLogId, { deals_upserted: 1 });
        } else {
          newRows.push(raw);
          const comments = String(raw.__sf_comments__ || "").trim();
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

        if (excelRows.length) {
          const queue = getIngestQueue();
          if (queue && QUEUE_NAME === "opportunity-ingest") {
            const jobId = ["excel-comments", "hubspot", orgId, syncLogId, String(totalProcessed)].join("_");
            try {
              await queue.add(
                "excel-comments",
                {
                  orgId,
                  fileName: "hubspot-ingest",
                  rows: excelRows,
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
        }
        for (const r of newRows) {
          const id = String(r.__hs_deal_id__ || "").trim();
          if (id) existingMeta.add(id);
        }
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
      .filter((r) => r.sf_field !== "company_name")
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

    const ownerCache = new Map<string, string>();
    const raw = await buildRawRowForDeal({
      orgId,
      deal: dealRes.data,
      mappingRows,
      notesSource,
      ownerCache,
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
