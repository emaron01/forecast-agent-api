import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { computeTrainingReadiness } from "../../../../lib/trainingReadiness";

export const runtime = "nodejs";

/** Roles that see executive summary only (CRO/SVP/VP/Manager) */
const EXECUTIVE_ROLES = ["EXEC_MANAGER", "MANAGER"] as const;

/** Roles that see full diagnostics (Admin/Owner) */
const FULL_ACCESS_ROLES = ["ADMIN"] as const;

/** Admin or admin_has_full_analytics_access gets full payload */
function hasFullAccess(role: string, adminHasFullAnalytics: boolean): boolean {
  return role === "ADMIN" || adminHasFullAnalytics;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (auth.kind !== "user") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const role = String(auth.user.role || "").trim();
    if (role === "REP") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (!EXECUTIVE_ROLES.includes(role as any) && !FULL_ACCESS_ROLES.includes(role as any) && !hasFullAccess(role, auth.user.admin_has_full_analytics_access)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const orgIdParam = url.searchParams.get("orgId")?.trim();
    const orgId = orgIdParam ? Number(orgIdParam) : auth.user.org_id;
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid orgId" }, { status: 400 });
    }

    const quotaPeriodId = url.searchParams.get("quotaPeriodId")?.trim() || undefined;
    const repIdsParam = url.searchParams.get("repIds");
    let repIds: number[] | undefined;
    if (repIdsParam) {
      repIds = repIdsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (role !== "ADMIN" && !auth.user.admin_has_full_analytics_access) {
      const scope = await getScopedRepDirectory({
        orgId,
        userId: auth.user.id,
        role: role as "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP",
      }).catch(() => ({ allowedRepIds: [] }));
      repIds = scope.allowedRepIds ?? undefined;
    }

    const snapshotOffsetDaysParam = url.searchParams.get("snapshot_offset_days");
    const snapshot_offset_days = snapshotOffsetDaysParam ? Number(snapshotOffsetDaysParam) : undefined;

    const result = await computeTrainingReadiness({
      orgId,
      quotaPeriodId,
      repIds,
      snapshot_offset_days,
    });

    const isFullAccess = hasFullAccess(role, auth.user.admin_has_full_analytics_access);

    if (isFullAccess) {
      return NextResponse.json({
        ok: true,
        readiness_summary: result.readiness_summary,
        coverage_by_category: result.coverage_by_category,
        gate_set_details: result.gate_set_details,
        training_snapshot_details: result.training_snapshot_details,
        leakage_diagnostics: result.leakage_diagnostics,
        missing_feature_breakdown: result.missing_feature_breakdown,
      });
    }

    return NextResponse.json({
      ok: true,
      readiness_summary: result.readiness_summary,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
