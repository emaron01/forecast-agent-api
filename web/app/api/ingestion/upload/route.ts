import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getFieldMappingSet, stageIngestionRows } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId, resolvePublicTextId } from "../../../../lib/publicId";
import { startSpan, endSpan, orgIdFromAuth, type SpanHandle } from "../../../../lib/perf";

export const runtime = "nodejs";

const JsonBodySchema = z.object({
  org_public_id: z.string().uuid().optional(),
  mapping_set_public_id: z.string().uuid(),
  rawRows: z.array(z.unknown()).min(1),
});

function parseUploadedTextToRows(text: string) {
  const t = String(text || "").trim();
  if (!t) return [] as unknown[];

  // JSON array
  if (t.startsWith("[")) {
    const v = JSON.parse(t);
    if (!Array.isArray(v)) throw new Error("Uploaded JSON must be an array");
    return v as unknown[];
  }

  // NDJSON (one JSON object per line)
  const rows: unknown[] = [];
  for (const line of t.split(/\r?\n/g)) {
    const s = line.trim();
    if (!s) continue;
    rows.push(JSON.parse(s));
  }
  return rows;
}

export async function POST(req: Request) {
  const callId = randomUUID();
  let auth: Awaited<ReturnType<typeof getAuth>> = null;
  let reqSpan: SpanHandle | null = null;
  try {
    auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const orgId = orgIdFromAuth(auth);
    reqSpan = startSpan({
      workflow: "ingestion",
      stage: "request_total",
      org_id: orgId,
      call_id: callId,
    });

    const contentType = String(req.headers.get("content-type") || "");

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const orgPublicId = String(form.get("org_public_id") || form.get("orgPublicId") || "").trim() || null;
      const mappingSetPublicId = String(form.get("mapping_set_public_id") || form.get("mappingSetPublicId") || form.get("mappingSetId") || "")
        .trim();

      const explicitOrgId = auth.kind === "master" && orgPublicId ? await resolvePublicId("organizations", orgPublicId) : 0;
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

      const pid = z.string().uuid().safeParse(mappingSetPublicId);
      if (!pid.success) {
        endSpan(reqSpan!, { status: "error", http_status: 400 });
        return NextResponse.json({ ok: false, error: "invalid_mapping_set_public_id" }, { status: 400 });
      }
      const mappingSetId = await resolvePublicTextId("field_mapping_sets", pid.data);
      const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
      if (!set) {
        endSpan(reqSpan!, { status: "error", http_status: 404 });
        return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        endSpan(reqSpan!, { status: "error", http_status: 400 });
        return NextResponse.json({ ok: false, error: "Missing file field: file" }, { status: 400 });
      }

      const text = await file.text();
      const rawRows = parseUploadedTextToRows(text);
      if (!rawRows.length) {
        endSpan(reqSpan!, { status: "error", http_status: 400 });
        return NextResponse.json({ ok: false, error: "No rows found in upload" }, { status: 400 });
      }

      const r = await stageIngestionRows({ organizationId, mappingSetId, rawRows });
      endSpan(reqSpan!, { status: "ok", http_status: 200 });
      return NextResponse.json({ ok: true, inserted: r.inserted });
    }

    // Default: JSON body
    const body = JsonBodySchema.parse(await req.json().catch(() => ({})));
    const explicitOrgId = auth.kind === "master" && body.org_public_id ? await resolvePublicId("organizations", body.org_public_id) : 0;
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

    const mappingSetId = await resolvePublicTextId("field_mapping_sets", body.mapping_set_public_id);
    const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
    if (!set) {
      endSpan(reqSpan!, { status: "error", http_status: 404 });
      return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });
    }

    const r = await stageIngestionRows({
      organizationId,
      mappingSetId,
      rawRows: body.rawRows,
    });
    endSpan(reqSpan!, { status: "ok", http_status: 200 });
    return NextResponse.json({ ok: true, inserted: r.inserted });
  } catch (e: any) {
    if (reqSpan) endSpan(reqSpan, { status: "error", http_status: 400 });
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

