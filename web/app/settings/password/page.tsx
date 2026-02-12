import Link from "next/link";
import { requireAuth } from "../../../lib/auth";
import { getOrganization } from "../../../lib/db";
import { updatePasswordAction } from "./actions";
import { UserTopNav } from "../../_components/UserTopNav";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SettingsPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") return null;
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const error = sp(searchParams.error) || "";
  const errorMessage = error === "invalid_password" ? "Current password is incorrect." : "";

  return (
    <div className="min-h-screen bg-[color:var(--sf-background)]">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto w-full max-w-xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Password</h1>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Update your password. You’ll be asked to sign in again.</p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Back
          </Link>
        </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          {errorMessage}
        </div>
      ) : null}

        <form
          action={updatePasswordAction}
          className="mt-6 grid gap-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm"
        >
          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Current password</label>
            <input
              name="current_password"
              type="password"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            />
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">New password</label>
            <input
              name="new_password"
              type="password"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            />
            <p className="text-xs text-[color:var(--sf-text-disabled)]">Minimum 8 characters.</p>
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Confirm new password</label>
            <input
              name="confirm_password"
              type="password"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Update password
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

