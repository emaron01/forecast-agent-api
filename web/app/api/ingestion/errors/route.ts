import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getFieldMappingSet, listIngestionStagingByFilter } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId, resolvePublicTextId } from "../../../../lib/publicId";
import { startSpan, endSpan, orgIdFromAuth } from "../../../../lib/perf";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const callId = randomUUID();
  let reqSpan: ReturnType<typeof startSpan> | null = null;
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    reqSpan = startSpan({
      workflow: "ingestion",
      stage: "request_total",
      org_id: orgIdFromAuth(auth),
      call_id: callId,
    });

    const url = new URL(req.url);
    const orgPublicIdParam = String(url.searchParams.get("orgPublicId") || "").trim();
    const mappingSetPublicId = String(url.searchParams.get("mappingSetPublicId") || "").trim();
    const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(url.searchParams.get("limit"));

    const explicitOrgId = auth.kind === "master" && orgPublicIdParam ? await resolvePublicId("organizations", orgPublicIdParam) : 0;
    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      endSpan(reqSpan!, { status: "error", http_status: 400 });
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const organizationId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!organizationId) {
      endSpan(reqSpan!, { status: "error", http_status: 400 });
      return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });
    }

    if (!mappingSetPublicId) {
      endSpan(reqSpan!, { status: "error", http_status: 400 });
      return NextResponse.json({ ok: false, error: "mappingSetPublicId is required" }, { status: 400 });
    }

    const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId);
    const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
    if (!set) {
      endSpan(reqSpan!, { status: "error", http_status: 404 });
      return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });
    }

    const rows = await listIngestionStagingByFilter({
      organizationId,
      mappingSetId,
      filter: "error",
      limit,
    });

    const publicRows = (rows || []).map((r: any) => ({
      public_id: String(r.public_id),
      status: r.status ?? null,
      error_message: r.error_message ?? null,
      raw_row: r.raw_row ?? null,
      normalized_row: r.normalized_row ?? null,
    }));

    endSpan(reqSpan!, { status: "ok", http_status: 200 });
    return NextResponse.json({ ok: true, mapping_set_public_id: mappingSetPublicId, rows: publicRows });
  } catch (e: any) {
    if (reqSpan) endSpan(reqSpan, { status: "error", http_status: 400 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

