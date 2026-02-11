import { NextResponse } from "next/server";
import { pool } from "../../../../lib/pool";
import { getAuth } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (auth.kind === "user" && auth.user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const names = ["normalize_row", "validate_row", "upsert_opportunity", "process_ingestion_batch"];
  const { rows } = await pool.query(
    `
    SELECT
      n.nspname AS schema,
      p.proname,
      p.oid::regprocedure::text AS signature,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = ANY($1::text[])
    ORDER BY p.proname ASC, p.oid ASC
    `,
    [names]
  );

  return NextResponse.json({ ok: true, functions: rows || [] });
}

