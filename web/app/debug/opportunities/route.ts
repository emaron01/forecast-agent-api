import { NextResponse } from "next/server";
import { pool } from "../../../lib/pool";
import { getAuth } from "../../../lib/auth";
import { resolvePublicId } from "../../../lib/publicId";

export const runtime = "nodejs";

function withCors(req: Request, res: NextResponse) {
  const origin = req.headers.get("origin") || "";
  const isLocal = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");

  if (isLocal) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS(req: Request) {
  return withCors(req, new NextResponse(null, { status: 204 }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const repName = url.searchParams.get("rep_name");

    const auth = await getAuth();
    if (!auth) return withCors(req, NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }));
    if (auth.kind === "user" && auth.user.role !== "ADMIN") {
      return withCors(req, NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }));
    }

    const orgPublicIdParam = String(url.searchParams.get("orgPublicId") || "").trim();
    const orgId =
      auth.kind === "user"
        ? auth.user.org_id
        : orgPublicIdParam
          ? await resolvePublicId("organizations", orgPublicIdParam)
          : auth.orgId || 0;
    if (!orgId) return withCors(req, NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 }));

    let query = `
      SELECT
        public_id::text AS public_id,
        rep_name,
        account_name,
        opportunity_name,
        crm_opp_id,
        amount,
        close_date,
        updated_at
      FROM opportunities
      WHERE org_id = $1
    `;
    const params: any[] = [orgId];

    if (repName) {
      query += " AND rep_name = $2";
      params.push(repName);
    }

    query += " ORDER BY updated_at DESC";

    const result = await pool.query(query, params);
    return withCors(req, NextResponse.json({ ok: true, opportunities: result.rows }));
  } catch (err: any) {
    console.error("❌ /debug/opportunities error:", err?.message || err);
    return withCors(
      req,
      NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
    );
  }
}

