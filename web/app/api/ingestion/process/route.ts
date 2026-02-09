import { NextResponse } from "next/server";
import { z } from "zod";
import { getFieldMappingSet, processIngestionBatch } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId, resolvePublicTextId } from "../../../../lib/publicId";

export const runtime = "nodejs";

const BodySchema = z.object({
  org_public_id: z.string().uuid().optional(),
  mapping_set_public_id: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = BodySchema.parse(await req.json().catch(() => ({})));

    const explicitOrgId = auth.kind === "master" && body.org_public_id ? await resolvePublicId("organizations", body.org_public_id) : 0;
    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const organizationId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!organizationId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    const mappingSetId = await resolvePublicTextId("field_mapping_sets", body.mapping_set_public_id);
    const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
    if (!set) return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });

    const r = await processIngestionBatch({
      organizationId,
      mappingSetId,
    });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

