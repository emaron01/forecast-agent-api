import { NextResponse } from "next/server";
import { getAuth, getMasterOrgIdFromCookies } from "../../../../../lib/auth";
import { isAdmin } from "../../../../../lib/roleHelpers";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

const VALID_SF_FIELDS = [
  "health_initial",
  "health_current",
  "risk_summary",
  "next_steps",
] as const;

async function resolveOrg(auth: NonNullable<Awaited<ReturnType<typeof getAuth>>>) {
  if (auth.kind === "user") {
    if (!isAdmin(auth.user)) {
      return { ok: false as const, status: 403 as const, error: "Forbidden" };
    }
    return { ok: true as const, orgId: auth.user.org_id };
  }
  const mid = getMasterOrgIdFromCookies();
  if (!mid) {
    return {
      ok: false as const,
      status: 400 as const,
      error: "Select an active organization first.",
    };
  }
  return { ok: true as const, orgId: mid };
}

export async function GET() {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const org = await resolveOrg(auth);
  if (org.ok === false) {
    return NextResponse.json({ ok: false, error: org.error }, { status: org.status });
  }

  const { rows } = await pool.query<{
    sf_field: string;
    sfdc_api_name: string | null;
  }>(
    `
    SELECT sf_field, sfdc_api_name
      FROM salesforce_writeback_mappings
     WHERE org_id = $1
     ORDER BY sf_field ASC
    `,
    [org.orgId]
  );

  // Return saved rows or defaults if not yet configured
  const mappings =
    rows && rows.length
      ? rows
      : VALID_SF_FIELDS.map((sf_field) => ({
          sf_field,
          sfdc_api_name: null,
        }));

  return NextResponse.json({ ok: true, mappings });
}

export async function PUT(req: Request) {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const org = await resolveOrg(auth);
  if (org.ok === false) {
    return NextResponse.json({ ok: false, error: org.error }, { status: org.status });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
  if (!mappings.length) {
    return NextResponse.json(
      { ok: false, error: "mappings array required" },
      { status: 400 }
    );
  }

  const normalized: Array<{
    sf_field: (typeof VALID_SF_FIELDS)[number];
    sfdc_api_name: string | null;
  }> = [];

  for (const row of mappings) {
    const sf_field = String(row?.sf_field || "").trim();
    const sfdc_api_name_raw = row?.sfdc_api_name;
    const sfdc_api_name =
      sfdc_api_name_raw == null || String(sfdc_api_name_raw).trim() === ""
        ? null
        : String(sfdc_api_name_raw).trim();

    if (!VALID_SF_FIELDS.includes(sf_field as (typeof VALID_SF_FIELDS)[number])) {
      return NextResponse.json(
        { ok: false, error: `invalid sf_field: ${sf_field}` },
        { status: 400 }
      );
    }

    normalized.push({
      sf_field: sf_field as (typeof VALID_SF_FIELDS)[number],
      sfdc_api_name,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of normalized) {
      await client.query(
        `
        INSERT INTO salesforce_writeback_mappings (org_id, sf_field, mode, sfdc_api_name)
        VALUES ($1, $2, 'sfdc_field', $3)
        ON CONFLICT (org_id, sf_field)
        DO UPDATE SET
          sfdc_api_name = EXCLUDED.sfdc_api_name,
          updated_at    = now()
        `,
        [org.orgId, row.sf_field, row.sfdc_api_name]
      );
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true });
}
