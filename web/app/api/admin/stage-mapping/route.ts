import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../lib/auth";
import { pool } from "../../../../lib/pool";

export const runtime = "nodejs";

const FieldSchema = z.enum(["forecast_category", "stage"]);

const BucketSchema = z.enum(["won", "commit", "best_case", "pipeline", "excluded"]).nullable();

const PatchSchema = z.object({
  field: FieldSchema,
  stage_value: z.string(),
  bucket: BucketSchema,
});

function orgIdFromAuth(auth: NonNullable<Awaited<ReturnType<typeof getAuth>>>) {
  if (auth.kind === "user") return auth.user.org_id;
  return auth.orgId ?? 0;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (auth.kind === "master") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    if (auth.user.role !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const orgId = orgIdFromAuth(auth);
    if (!orgId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    const url = new URL(req.url);
    const field = FieldSchema.safeParse(String(url.searchParams.get("field") || "").trim());
    if (!field.success) {
      return NextResponse.json({ ok: false, error: "invalid_field" }, { status: 400 });
    }

    const col = field.data === "forecast_category" ? "forecast_stage" : "sales_stage";

    const { rows } = await pool.query<{
      stage_value: string;
      opp_count: string;
      mapped_bucket: string | null;
    }>(
      `
      SELECT
        COALESCE(NULLIF(btrim(o.${col}::text), ''), '(empty)') AS stage_value,
        COUNT(*)::int AS opp_count,
        MAX(m.bucket) AS mapped_bucket
      FROM opportunities o
      LEFT JOIN org_stage_mappings m
        ON m.org_id = $1::bigint
       AND m.field = $2::text
       AND lower(btrim(m.stage_value)) = lower(btrim(COALESCE(NULLIF(btrim(o.${col}::text), ''), '')))
      WHERE o.org_id = $1::bigint
      GROUP BY COALESCE(NULLIF(btrim(o.${col}::text), ''), '(empty)')
      ORDER BY 1 ASC
      `,
      [orgId, field.data]
    );

    return NextResponse.json({
      ok: true,
      field: field.data,
      rows: (rows || []).map((r) => ({
        stage_value: r.stage_value,
        opp_count: Number(r.opp_count) || 0,
        mapped_bucket: r.mapped_bucket,
      })),
    });
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") {
      return NextResponse.json({ ok: false, error: "migration_required" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (auth.kind === "master") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    if (auth.user.role !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const orgId = orgIdFromAuth(auth);
    if (!orgId) return NextResponse.json({ ok: false, error: "missing_org" }, { status: 400 });

    const json = await req.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    }

    const { field, stage_value: rawSv, bucket } = parsed.data;
    const stageNorm = rawSv === "(empty)" ? "" : rawSv;

    if (bucket == null) {
      await pool.query(
        `
        DELETE FROM org_stage_mappings
         WHERE org_id = $1::bigint
           AND field = $2::text
           AND lower(btrim(stage_value)) = lower(btrim($3::text))
        `,
        [orgId, field, stageNorm]
      );
    } else {
      await pool.query(
        `
        INSERT INTO org_stage_mappings (org_id, field, stage_value, bucket, updated_at)
        VALUES ($1::bigint, $2::text, btrim($3::text), $4::text, NOW())
        ON CONFLICT (org_id, field, stage_value)
        DO UPDATE SET bucket = EXCLUDED.bucket, updated_at = NOW()
        `,
        [orgId, field, stageNorm, bucket]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "42P01") {
      return NextResponse.json({ ok: false, error: "migration_required" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
