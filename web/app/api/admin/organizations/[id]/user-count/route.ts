import { NextResponse } from "next/server";
import { getAuth } from "../../../../../../lib/auth";
import { countActiveUsersForOrg, getOrganization } from "../../../../../../lib/db";
import { resolvePublicId } from "../../../../../../lib/publicId";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id: idParam } = await ctx.params;
    const orgPublicId = String(idParam || "").trim();
    if (!orgPublicId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const orgId = await resolvePublicId("organizations", orgPublicId).catch(() => 0);
    if (!orgId) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (auth.kind === "user" && auth.user.org_id !== orgId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const org = await getOrganization({ id: orgId });
    if (!org) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const activeCount = await countActiveUsersForOrg({ orgId });
    const maxUsers = org.max_users;

    return NextResponse.json({ activeCount, maxUsers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
