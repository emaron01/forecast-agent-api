import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "../../../../lib/auth";
import { getScopedRepDirectory } from "../../../../lib/repScope";
import { HIERARCHY, isAdmin, isSalesLeader, isSalesRep } from "../../../../lib/roleHelpers";
import { computeTrainingReadiness } from "../../../../lib/trainingReadiness";

export const runtime = "nodejs";

/** Admin or admin_has_full_analytics_access gets full payload */
function hasFullAccess(hierarchyLevel: number, adminHasFullAnalytics: boolean): boolean {
  return hierarchyLevel === HIERARCHY.ADMIN || adminHasFullAnalytics;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth();
    if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (auth.kind !== "user") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    if (isSalesRep(auth.user) || auth.user.hierarchy_level === HIERARCHY.CHANNEL_REP) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (!isSalesLeader(auth.user) && !isAdmin(auth.user) && !hasFullAccess(auth.user.hierarchy_level, auth.user.admin_has_full_analytics_access)) {
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
    } else if (!isAdmin(auth.user) && !auth.user.admin_has_full_analytics_access) {
      const scope = await getScopedRepDirectory({
        orgId,
        user: auth.user,
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

    const isFullAccess = hasFullAccess(auth.user.hierarchy_level, auth.user.admin_has_full_analytics_access);

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
