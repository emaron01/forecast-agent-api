import { NextResponse } from "next/server";
import { pool } from "../../../lib/pool";
import { getAuth } from "../../../lib/auth";

export const runtime = "nodejs";

function safeDbHostFromEnv() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return { rawPresent: false as const, host: "" };
  try {
    const u = new URL(raw);
    return { rawPresent: true as const, host: u.host || "" };
  } catch {
    // Best-effort: try to extract between @ and next / or end
    const at = raw.lastIndexOf("@");
    if (at >= 0) {
      const tail = raw.slice(at + 1);
      const slash = tail.indexOf("/");
      const host = (slash >= 0 ? tail.slice(0, slash) : tail).trim();
      return { rawPresent: true as const, host };
    }
    return { rawPresent: true as const, host: "" };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (auth.kind === "user" && auth.user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const orgId =
    auth.kind === "user" ? auth.user.org_id : auth.orgId || Number(url.searchParams.get("orgId") || "0");

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ ok: false, error: "DATABASE_URL is not set" }, { status: 500 });
    }

    const dbEnv = safeDbHostFromEnv();
    const t0 = Date.now();
    const nowRes = await pool.query("SELECT NOW() as now");

    const functionChecks = await pool.query(
      `
      SELECT
        to_regprocedure('normalize_row(jsonb,bigint)') IS NOT NULL AS has_normalize_row,
        to_regprocedure('validate_row(jsonb,integer)') IS NOT NULL AS has_validate_row,
        to_regprocedure('upsert_opportunity(jsonb,integer)') IS NOT NULL AS has_upsert_opportunity,
        to_regprocedure('process_ingestion_batch(integer,bigint)') IS NOT NULL AS has_process_ingestion_batch
      `
    );

    const counts: any = {};
    if (orgId) {
      const opp = await pool.query("SELECT COUNT(*)::int AS n FROM opportunities WHERE org_id = $1", [orgId]);
      const audits = await pool.query(
        "SELECT COUNT(*)::int AS n FROM opportunity_audit_events WHERE org_id = $1",
        [orgId]
      );
      counts.opportunities = Number(opp.rows?.[0]?.n ?? 0);
      counts.opportunity_audit_events = Number(audits.rows?.[0]?.n ?? 0);
    }

    return NextResponse.json({
      ok: true,
      dbHost: dbEnv.host || null,
      dbNow: String(nowRes.rows?.[0]?.now || ""),
      orgId: orgId || null,
      functions: functionChecks.rows?.[0] || null,
      counts: orgId ? counts : null,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    const dbEnv = safeDbHostFromEnv();
    return NextResponse.json(
      {
        ok: false,
        error: String(e?.message || e),
        orgId: orgId || null,
        dbHost: dbEnv.host || null,
      },
      { status: 500 }
    );
  }
}

