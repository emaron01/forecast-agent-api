import { NextResponse } from "next/server";
import { pool } from "../../../../lib/pool";
import { getAuth } from "../../../../lib/auth";
import { getVisibleUsers } from "../../../../lib/db";

export const runtime = "nodejs";

type MatchRow = {
  id: number;
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

    if (!orgId) return NextResponse.json({ ok: false, error: "Missing org context" }, { status: 400 });
    if (!q) return NextResponse.json({ ok: true, matches: [] });

    // Role scoping:
    // - REP: forced to their own account_owner_name
    // - MANAGER: restricted to reps in their visible subtree (manager chain)
    // - ADMIN/master: unrestricted within org (optionally filter by repName)
    const scope =
      auth.kind === "user"
        ? auth.user.role === "REP"
          ? { kind: "rep" as const, repName: auth.user.account_owner_name }
          : auth.user.role === "MANAGER"
            ? { kind: "scoped" as const, userId: auth.user.id, role: "MANAGER" as const }
            : auth.user.admin_has_full_analytics_access
              ? { kind: "admin" as const }
              : { kind: "scoped" as const, userId: auth.user.id, role: "ADMIN" as const }
        : { kind: "admin" as const };

    const scopedAllowedRepNames =
      scope.kind === "scoped"
        ? (
            await getVisibleUsers({
              currentUserId: scope.userId,
              orgId,
              role: scope.role,
              admin_has_full_analytics_access: auth.kind === "user" ? auth.user.admin_has_full_analytics_access : undefined,
            }).catch(() => [])
          )
            .filter((u) => u.role === "REP" && u.active)
            .map((u) => u.account_owner_name)
            .filter(Boolean)
        : [];

    // If they typed a numeric id, allow quick direct lookup too.
    const asId = Number.parseInt(q, 10);
    if (Number.isFinite(asId) && String(asId) === q) {
      const whereExtra =
        scope.kind === "rep"
          ? " AND rep_name = $3"
          : scope.kind === "scoped"
            ? " AND rep_name = ANY($3::text[])"
            : requestedRepName
              ? " AND rep_name = $3"
              : "";
      const params: any[] = [orgId, asId];
      if (scope.kind === "rep") params.push(scope.repName);
      else if (scope.kind === "scoped") params.push(scopedAllowedRepNames.length ? scopedAllowedRepNames : ["__none__"]);
      else if (requestedRepName) params.push(requestedRepName);

      const { rows } = await pool.query(
        `
        SELECT id, account_name, opportunity_name, rep_name, amount, close_date, updated_at
          FROM opportunities
         WHERE org_id = $1
           AND id = $2
           ${whereExtra}
         LIMIT 1
        `,
        params
      );
      return NextResponse.json({ ok: true, matches: (rows || []) as MatchRow[] });
    }

    const like = `%${q}%`;
    const params: any[] = [orgId, like];
    let repClause = "";
    if (scope.kind === "rep") {
      params.push(scope.repName);
      repClause = ` AND rep_name = $3`;
    } else if (scope.kind === "scoped") {
      params.push(scopedAllowedRepNames.length ? scopedAllowedRepNames : ["__none__"]);
      repClause = ` AND rep_name = ANY($3::text[])`;
    } else if (requestedRepName) {
      params.push(requestedRepName);
      repClause = ` AND rep_name = $3`;
    }

    const { rows } = await pool.query(
      `
      SELECT id, account_name, opportunity_name, rep_name, amount, close_date, updated_at
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

