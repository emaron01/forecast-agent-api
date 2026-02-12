import Link from "next/link";
import { redirect } from "next/navigation";
import { Modal } from "../_components/Modal";
import { requireAuth } from "../../../lib/auth";
import { getEmailTemplateByKey, listEmailTemplates } from "../../../lib/db";
import { upsertEmailTemplateAction } from "../actions/emailTemplates";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function EmailTemplatesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const modal = sp(searchParams.modal) || "";
  const key = sp(searchParams.key) || "";

  const templates = await listEmailTemplates().catch(() => []);
  const tpl = modal === "edit" && key ? await getEmailTemplateByKey({ template_key: key }).catch(() => null) : null;

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Email templates</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Global templates managed by the SaaS owner.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/control-center"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Owner control center
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
            <tr>
              <th className="px-4 py-3">key</th>
              <th className="px-4 py-3">subject</th>
              <th className="px-4 py-3">active</th>
              <th className="px-4 py-3 text-right">actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length ? (
              templates.map((t) => (
                <tr key={t.template_key} className="border-t border-[color:var(--sf-border)]">
                  <td className="px-4 py-3 font-mono text-xs">{t.template_key}</td>
                  <td className="px-4 py-3">{t.subject}</td>
                  <td className="px-4 py-3">{t.active ? "true" : "false"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/email-templates?modal=edit&key=${encodeURIComponent(t.template_key)}`}
                      className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                  No templates found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal === "edit" && tpl ? (
        <Modal title={`Edit template "${tpl.template_key}"`} closeHref="/admin/email-templates">
          <form action={upsertEmailTemplateAction} className="grid gap-3">
            <input type="hidden" name="template_key" value={tpl.template_key} />
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">subject</label>
              <input
                name="subject"
                defaultValue={tpl.subject}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">body</label>
              <textarea
                name="body"
                defaultValue={tpl.body}
                rows={10}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
                required
              />
              <p className="text-xs text-[color:var(--sf-text-disabled)]">
                Use placeholders like {"{{org_name}}"}, {"{{display_name}}"}, {"{{invite_link}}"}, {"{{reset_link}}"}.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">active</label>
              <select
                name="active"
                defaultValue={tpl.active ? "true" : "false"}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link
                href="/admin/email-templates"
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

