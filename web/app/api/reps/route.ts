import { NextResponse } from "next/server";
import { z } from "zod";
import { listReps } from "../../../lib/db";
import { getAuth } from "../../../lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    if (auth.kind === "user" && auth.user.role === "REP") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const organizationId =
      auth.kind === "user"
        ? auth.user.org_id
        : auth.orgId
          ? auth.orgId
          : (() => {
              throw new Error("Master admin must select an active org");
            })();

    const url = new URL(req.url);
    const activeOnly = z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v !== "0")
      .parse(url.searchParams.get("activeOnly") ?? undefined);

    const reps = await listReps({ organizationId, activeOnly });
    const publicReps = (reps || []).map((r: any) => ({
      public_id: String(r.public_id),
      rep_name: r.rep_name ?? null,
      display_name: r.display_name ?? null,
      crm_owner_id: r.crm_owner_id ?? null,
      crm_owner_name: r.crm_owner_name ?? null,
      user_public_id: r.user_public_id ?? null,
      manager_rep_public_id: r.manager_rep_public_id ?? null,
      role: r.role ?? null,
      active: r.active == null ? null : !!r.active,
    }));
    return NextResponse.json({ ok: true, reps: publicReps });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

