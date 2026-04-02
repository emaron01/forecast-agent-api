import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { listUsers } from "../../../lib/db";
import { isAdmin, isChannelExec, isChannelManager, isChannelRole } from "../../../lib/roleHelpers";
import {
  deleteChannelAlignment,
  listChannelAlignments,
  saveChannelAlignment,
} from "../actions/channelAlignment";

export const runtime = "nodejs";

async function saveChannelAlignmentAction(formData: FormData) {
  "use server";

  const ctx = await requireAuth();
  if (ctx.kind !== "user" || (!isAdmin(ctx.user) && !isChannelExec(ctx.user) && !isChannelManager(ctx.user))) {
    redirect("/dashboard/channel");
  }

  const orgId = ctx.user.org_id;
  await saveChannelAlignment({
    orgId,
    channelUserId: Number(formData.get("channel_user_id")),
    salesLeaderIds: [Number(formData.get("sales_leader_id"))],
    alignFullTeam: true,
  });
  revalidatePath("/admin/channel-alignment");
}

async function deleteChannelAlignmentAction(formData: FormData) {
  "use server";

  const ctx = await requireAuth();
  if (ctx.kind !== "user" || (!isAdmin(ctx.user) && !isChannelExec(ctx.user) && !isChannelManager(ctx.user))) {
    redirect("/dashboard/channel");
  }

  const orgId = ctx.user.org_id;
  await deleteChannelAlignment({
    orgId,
    channelUserId: Number(formData.get("channel_user_id")),
    salesLeaderId: Number(formData.get("sales_leader_id")),
  });
  revalidatePath("/admin/channel-alignment");
}

export default async function ChannelAlignmentPage() {
  const ctx = await requireAuth();
  if (ctx.kind !== "user" || (!isAdmin(ctx.user) && !isChannelExec(ctx.user) && !isChannelManager(ctx.user))) {
    redirect("/dashboard/channel");
  }

  const orgId = ctx.user.org_id;
  const allUsers = await listUsers({ orgId, includeInactive: false }).catch(() => []);
  const channelUsers = allUsers
    .filter((user) =>
      isAdmin(ctx.user)
        ? isChannelRole(user)
        : user.manager_user_id === ctx.user.id && isChannelRole(user)
    )
    .filter((user) => user.active ?? true)
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));
  const salesLeaders = allUsers
    .filter((user) => [1, 2].includes(Number(user.hierarchy_level)))
    .filter((user) => user.active ?? true)
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || "")));
  const alignments = await listChannelAlignments(orgId).catch(() => []);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
          Channel Territory Alignment
        </h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Assign channel team members to sales territories. Channel users will see deals from their aligned sales
          territory.
        </p>
      </div>

      {channelUsers.map((user) => {
        const userAlignments = alignments.filter((alignment) => Number(alignment.channel_user_id) === Number(user.id));
        const alignedLeaderIds = new Set(userAlignments.map((alignment) => Number(alignment.sales_leader_id)));
        const availableSalesLeaders = salesLeaders.filter((leader) => !alignedLeaderIds.has(Number(leader.id)));

        return (
          <div
            key={user.id}
            className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-[color:var(--sf-text-primary)]">{user.display_name}</div>
                <div className="text-sm text-[color:var(--sf-text-secondary)]">
                  {user.role} {user.title ? `· ${user.title}` : ""}
                </div>
              </div>
            </div>

            <div className="mb-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">
                Aligned to Sales Leaders
              </div>
              {userAlignments.length === 0 ? (
                <div className="text-sm text-[color:var(--sf-text-secondary)]">
                  No alignments — using reporting chain for territory scope
                </div>
              ) : null}
              {userAlignments.map((alignment) => (
                <div key={alignment.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-[color:var(--sf-text-primary)]">{alignment.sales_leader_name}</span>
                  <form action={deleteChannelAlignmentAction}>
                    <input type="hidden" name="channel_user_id" value={user.id} />
                    <input type="hidden" name="sales_leader_id" value={alignment.sales_leader_id} />
                    <button type="submit" className="text-xs text-red-400 hover:underline">
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>

            <form action={saveChannelAlignmentAction}>
              <input type="hidden" name="channel_user_id" value={user.id} />
              <div className="flex gap-2">
                <select
                  name="sales_leader_id"
                  className="flex-1 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  defaultValue=""
                >
                  <option value="">Select sales leader...</option>
                  {availableSalesLeaders.map((leader) => (
                    <option key={leader.id} value={leader.id}>
                      {leader.display_name} ({leader.role})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-[color:var(--sf-accent-primary)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        );
      })}
    </main>
  );
}
