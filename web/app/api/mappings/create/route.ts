import { NextResponse } from "next/server";
import { z } from "zod";
import { createFieldMappingSet } from "../../../../lib/db";
import { getAuth } from "../../../../lib/auth";
import { resolvePublicId } from "../../../../lib/publicId";

export const runtime = "nodejs";

const BodySchema = z.object({
  org_public_id: z.string().uuid().optional(),
  name: z.string().min(1),
  source_system: z.string().optional(),
});

function emptyToNull(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

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

    const set = await createFieldMappingSet({
      organizationId,
      name: body.name,
      source_system: emptyToNull(body.source_system),
    });
    return NextResponse.json(
      {
        ok: true,
        mappingSet: { public_id: set.public_id, name: set.name, source_system: set.source_system },
      },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

