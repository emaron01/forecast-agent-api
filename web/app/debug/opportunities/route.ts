import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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
    const orgId = Number(url.searchParams.get("org_id") || "1") || 1;
    const repName = url.searchParams.get("rep_name");

    let query = `
      SELECT *
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
    return withCors(req, NextResponse.json(result.rows));
  } catch (err: any) {
    console.error("❌ /debug/opportunities error:", err?.message || err);
    return withCors(
      req,
      NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
    );
  }
}

