import { NextResponse } from "next/server";
import { z } from "zod";
import { createFieldMapping, getFieldMappingSet } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId, resolvePublicTextId } from "../../../../lib/publicId";

export const runtime = "nodejs";

const BodySchema = z.object({
  mapping_set_public_id: z.string().uuid(),
  org_public_id: z.string().uuid().optional(),
  source_field: z.string().min(1),
  target_field: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    // Hard lock: free-text target_field creation is owner/super-user only.
    // Customers manage saved formats through the Import page server action, which enforces target allowlists.
    if (auth.kind !== "master") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const explicitOrgId = body.org_public_id ? await resolvePublicId("organizations", body.org_public_id) : 0;
    const cookieOrgId = auth.orgId || 0;
    if (explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const organizationId = explicitOrgId || cookieOrgId || 0;
    if (!organizationId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    const mappingSetId = await resolvePublicTextId("field_mapping_sets", body.mapping_set_public_id);
    const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
    if (!set) return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });

    const mapping = await createFieldMapping({
      mappingSetId,
      source_field: body.source_field,
      target_field: body.target_field,
    });
    return NextResponse.json(
      {
        ok: true,
        fieldMapping: { public_id: mapping.public_id, source_field: mapping.source_field, target_field: mapping.target_field },
      },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

