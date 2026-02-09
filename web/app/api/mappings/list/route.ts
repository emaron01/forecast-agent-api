import { NextResponse } from "next/server";
import { getFieldMappingSet, listFieldMappingSets, listFieldMappings } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId, resolvePublicTextId } from "../../../../lib/publicId";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const orgPublicIdParam = String(url.searchParams.get("orgPublicId") || "").trim();
    const mappingSetPublicId = String(url.searchParams.get("mappingSetPublicId") || "").trim();

    const cookieOrgId = auth.kind === "master" ? auth.orgId || 0 : 0;
    const explicitOrgId = auth.kind === "master" && orgPublicIdParam ? await resolvePublicId("organizations", orgPublicIdParam) : 0;
    if (auth.kind === "master" && explicitOrgId && cookieOrgId && explicitOrgId !== cookieOrgId) {
      return NextResponse.json({ ok: false, error: "org_mismatch" }, { status: 400 });
    }
    const organizationId = auth.kind === "user" ? auth.user.org_id : explicitOrgId || cookieOrgId || 0;
    if (!organizationId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    const mappingSets = await listFieldMappingSets({ organizationId });
    const publicMappingSets = (mappingSets || []).map((s: any) => ({
      public_id: String(s.public_id),
      name: s.name ?? null,
      source_system: s.source_system ?? null,
    }));

    if (!mappingSetPublicId) {
      return NextResponse.json({ ok: true, mappingSets: publicMappingSets });
    }

    const mappingSetId = await resolvePublicTextId("field_mapping_sets", mappingSetPublicId);
    const set = await getFieldMappingSet({ organizationId, mappingSetId }).catch(() => null);
    if (!set) return NextResponse.json({ ok: false, error: "mapping_set_not_found" }, { status: 404 });
    const fieldMappings = await listFieldMappings({ mappingSetId });
    const publicFieldMappings = (fieldMappings || []).map((m: any) => ({
      public_id: String(m.public_id),
      source_field: m.source_field ?? null,
      target_field: m.target_field ?? null,
    }));
    return NextResponse.json({
      ok: true,
      mappingSets: publicMappingSets,
      mappingSetPublicId,
      fieldMappings: publicFieldMappings,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

