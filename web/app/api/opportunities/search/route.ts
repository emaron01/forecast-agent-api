import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "../../../../lib/pool";
import { getAuth } from "../../../../lib/auth";
import { getVisibleUsers } from "../../../../lib/db";
import { HIERARCHY, isChannelRole, isSalesLeader, isSalesRep } from "../../../../lib/roleHelpers";

export const runtime = "nodejs";

type MatchRow = {
  public_id: string;
  account_name: string | null;
  opportunity_name: string | null;
  rep_name: string | null;
  amount: number | null;
  close_date: string | null;
  updated_at: string | null;
};

export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const orgId = auth.kind === "user" ? auth.user.org_id : auth.orgId || 0;
    const q = String(url.searchParams.get("q") || "").trim();
    const requestedRepName = String(url.searchParams.get("repName") || "").trim();
    const repPublicIdParam = String(url.searchParams.get("repPublicId") || url.searchParams.get("rep_public_id") || "").trim();

    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });
    if (!q) return NextResponse.json({ ok: true, matches: [] });

    // Role scoping (opportunities filtered by internal rep_id, not CRM rep_name text):
    // - REP: reps row for auth.user.id in this org
    // - MANAGER: rep ids for visible subtree users (user_id on reps)
    // - ADMIN/master: unrestricted within org (optional filter via rep public_id or reps.rep_name → id)
    const scope =
      auth.kind === "user"
        ? isSalesRep(auth.user) || auth.user.hierarchy_level === 8
          ? { kind: "rep" as const }
          : isSalesLeader(auth.user) || isChannelRole(auth.user)
            ? {
                kind: "scoped" as const,
                userId: auth.user.id,
              }
            : { kind: "admin" as const }
        : { kind: "admin" as const };

    const scopedVisibleReps =
      scope.kind === "scoped" && auth.kind === "user"
        ? (
            await getVisibleUsers({
              orgId,
              user: auth.user,
            }).catch(() => [])
          ).filter((u) => (Number(u.hierarchy_level) === HIERARCHY.REP || Number(u.hierarchy_level) === HIERARCHY.CHANNEL_REP) && u.active)
        : [];

    const scopedUserIds = scopedVisibleReps.map((u) => u.id).filter((id) => Number.isFinite(id));

    const scopedRepIds: number[] =
      scopedUserIds.length > 0
        ? await pool
            .query<{ id: string }>(
              `
              SELECT id::text AS id
                FROM reps
               WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
                 AND user_id = ANY($2::int[])
              `,
              [orgId, scopedUserIds]
            )
            .then((r) => (r.rows || []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id)))
            .catch(() => [])
        : [];

    let myRepId: number | null = null;
    if (scope.kind === "rep" && auth.kind === "user") {
      const { rows } = await pool.query<{ id: string }>(
        `
        SELECT id::text AS id
          FROM reps
         WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
           AND user_id = $2::int
         LIMIT 1
        `,
        [orgId, auth.user.id]
      );
      const id = rows?.[0]?.id;
      myRepId = id != null && String(id).trim() !== "" && Number.isFinite(Number(id)) ? Number(id) : null;
    }

    // Optional explicit rep filter: public_id (preferred) or reps.rep_name → internal id (admin only).
    let adminRepIdFilter: number | null = null;
    if (repPublicIdParam) {
      const parsedPid = z.string().uuid().safeParse(repPublicIdParam);
      if (!parsedPid.success) return NextResponse.json({ ok: false, error: "invalid_rep_public_id" }, { status: 400 });
      const { rows: repRows } = await pool.query<{ id: string }>(
        `SELECT id::text AS id FROM reps WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint AND public_id = $2::uuid LIMIT 1`,
        [orgId, parsedPid.data]
      );
      const id = repRows?.[0]?.id;
      adminRepIdFilter = id != null && Number.isFinite(Number(id)) ? Number(id) : null;
      if (adminRepIdFilter == null) return NextResponse.json({ ok: true, matches: [] });
    } else if (requestedRepName && scope.kind === "admin") {
      const { rows } = await pool.query<{ id: string }>(
        `
        SELECT id::text AS id
          FROM reps
         WHERE COALESCE(organization_id, org_id::bigint) = $1::bigint
           AND lower(btrim(COALESCE(rep_name, ''))) = lower(btrim($2::text))
         ORDER BY id ASC
         LIMIT 2
        `,
        [orgId, requestedRepName]
      );
      if (rows?.length === 1) adminRepIdFilter = Number(rows[0].id);
      else return NextResponse.json({ ok: true, matches: [] });
    }

    // Direct lookup by opportunity public_id (UUID string).
    const asPublicId = z.string().uuid().safeParse(q);
    if (asPublicId.success) {
      if (scope.kind === "rep" && myRepId == null) {
        return NextResponse.json({ ok: true, matches: [] });
      }
      const whereExtra =
        scope.kind === "rep"
          ? " AND rep_id = $3::bigint"
          : scope.kind === "scoped"
            ? " AND rep_id = ANY($3::bigint[])"
            : adminRepIdFilter != null
              ? " AND rep_id = $3::bigint"
              : "";
      const params: any[] = [orgId, asPublicId.data];
      if (scope.kind === "rep") params.push(myRepId);
      else if (scope.kind === "scoped") params.push(scopedRepIds);
      else if (adminRepIdFilter != null) params.push(adminRepIdFilter);

      const { rows } = await pool.query(
        `
        SELECT public_id::text AS public_id, account_name, opportunity_name, rep_name, amount, close_date, updated_at
          FROM opportunities
         WHERE org_id = $1
           AND public_id = $2
           ${whereExtra}
         LIMIT 1
        `,
        params
      );
      return NextResponse.json({ ok: true, matches: (rows || []) as MatchRow[] });
    }

    if (scope.kind === "rep" && myRepId == null) {
      return NextResponse.json({ ok: true, matches: [] });
    }

    const like = `%${q}%`;
    const params: any[] = [orgId, like];
    let repClause = "";
    if (scope.kind === "rep") {
      params.push(myRepId);
      repClause = ` AND rep_id = $3::bigint`;
    } else if (scope.kind === "scoped") {
      params.push(scopedRepIds);
      repClause = ` AND rep_id = ANY($3::bigint[])`;
    } else if (adminRepIdFilter != null) {
      params.push(adminRepIdFilter);
      repClause = ` AND rep_id = $3::bigint`;
    }

    const { rows } = await pool.query(
      `
      SELECT public_id::text AS public_id, account_name, opportunity_name, rep_name, amount, close_date, updated_at
        FROM opportunities
       WHERE org_id = $1
         AND (account_name ILIKE $2 OR opportunity_name ILIKE $2)
         ${repClause}
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 25
      `,
      params
    );

    return NextResponse.json({ ok: true, matches: (rows || []) as MatchRow[] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

