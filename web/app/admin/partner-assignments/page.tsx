import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { listUsers } from "../../../lib/db";
import { isAdmin } from "../../../lib/roleHelpers";
import {
  listDistinctPartners,
  listPartnerAssignments,
  savePartnerAssignment,
} from "../actions/partnerAssignments";

export const runtime = "nodejs";

async function savePartnerAssignmentAction(formData: FormData) {
  "use server";

  const ctx = await requireAuth();
  if (ctx.kind !== "user" || !isAdmin(ctx.user)) redirect("/admin");

  const orgId = ctx.user.org_id;
  const channelRepIdRaw = String(formData.get("channel_rep_id") || "").trim();

  await savePartnerAssignment({
    orgId,
    partnerName: String(formData.get("partner_name") || ""),
    channelRepId: channelRepIdRaw ? Number(channelRepIdRaw) : null,
  });
  revalidatePath("/admin/partner-assignments");
}

export default async function PartnerAssignmentsPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user" || !isAdmin(ctx.user)) redirect("/admin");

  const orgId = ctx.user.org_id;
  const [distinctPartners, partnerAssignments, users] = await Promise.all([
    listDistinctPartners(orgId).catch(() => []),
    listPartnerAssignments(orgId).catch(() => ({ assignments: [], unassignedPartners: [] })),
    listUsers({ orgId, includeInactive: false }).catch(() => []),
  ]);

  const channelReps = users
    .filter((user) => Number(user.hierarchy_level) === 8)
    .filter((user) => user.active ?? true)
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));

  const allPartners = Array.from(
    new Set([
      ...distinctPartners,
      ...partnerAssignments.assignments.map((assignment) => String(assignment.partner_name || "").trim()),
    ].filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Partner Assignments</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Assign partners to channel reps. Unassigned partners are visible to all channel reps in the territory.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
              <th className="px-4 py-3 text-left font-semibold">Partner</th>
              <th className="px-4 py-3 text-left font-semibold">Assigned Rep</th>
              <th className="px-4 py-3 text-left font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {allPartners.map((partner) => {
              const assignment = partnerAssignments.assignments.find((item) => item.partner_name === partner);

              return (
                <tr key={partner} className="border-b border-[color:var(--sf-border)] last:border-b-0">
                  <td className="px-4 py-3 font-medium text-[color:var(--sf-text-primary)]">{partner}</td>
                  <td className="px-4 py-3">
                    <form action={savePartnerAssignmentAction} className="flex items-center gap-2">
                      <input type="hidden" name="partner_name" value={partner} />
                      <select
                        name="channel_rep_id"
                        defaultValue={assignment?.channel_rep_id == null ? "" : String(assignment.channel_rep_id)}
                        className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1.5 text-sm text-[color:var(--sf-text-primary)]"
                      >
                        <option value="">Unassigned (all reps)</option>
                        {channelReps.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.display_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg bg-[color:var(--sf-accent-primary)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-sm text-[color:var(--sf-text-secondary)]">
                    {assignment ? assignment.channel_rep_name : "Currently unassigned"}
                  </td>
                </tr>
              );
            })}
            {allPartners.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-[color:var(--sf-text-secondary)]">
                  No partners found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
