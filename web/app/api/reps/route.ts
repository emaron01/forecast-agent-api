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
    return NextResponse.json({ ok: true, reps });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}

