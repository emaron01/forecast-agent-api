import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "../../../../lib/auth";
import { loadReportBuilderRepRowsForUser } from "../../../../lib/reportBuilderRepRowsServer";

export const runtime = "nodejs";

const BodySchema = z.object({
  periodId: z.string().min(1),
});

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") return jsonError(403, "Forbidden");
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch {
    return jsonError(400, "Invalid body");
  }

  try {
    const { repRows, periodLabel } = await loadReportBuilderRepRowsForUser({
      orgId: ctx.user.org_id,
      userId: ctx.user.id,
      userRole: ctx.user.role,
      periodId: body.periodId,
    });
    return NextResponse.json({ ok: true, repRows, periodLabel });
  } catch (e: any) {
    return jsonError(500, String(e?.message || e || "Failed to load report data"));
  }
}
