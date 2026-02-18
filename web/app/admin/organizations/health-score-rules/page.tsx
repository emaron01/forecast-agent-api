import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Modal } from "../../_components/Modal";
import { requireAuth } from "../../../../lib/auth";
import { listOrganizations } from "../../../../lib/db";
import { pool } from "../../../../lib/pool";
import { resolvePublicId } from "../../../../lib/publicId";

export const runtime = "nodejs";

const CATEGORY_OPTIONS = ["Commit", "Best Case", "Pipeline"] as const;
type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function closeHref(orgPublicId?: string) {
  const base = "/admin/organizations/health-score-rules";
  return orgPublicId ? `${base}?org=${encodeURIComponent(orgPublicId)}` : base;
}

function parseIntSafe(raw: any) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseNumSafe(raw: any) {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

type RuleRow = {
  id: number;
  org_id: number;
  min_score: number;
  max_score: number;
  mapped_category: string;
  suppression: boolean | null;
  probability_modifier: number | null;
  created_at: string | null;
  updated_at: string | null;
};

async function upsertRuleAction(formData: FormData) {
  "use server";
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const orgPublicId = String(formData.get("org_public_id") || "").trim();
  const mode = String(formData.get("mode") || "").trim(); // new | edit
  const idRaw = String(formData.get("id") || "").trim();

  if (!orgPublicId) redirect(`${closeHref()}&error=${encodeURIComponent("org is required")}`);
  const orgId = await resolvePublicId("organizations", orgPublicId).catch(() => 0);
  if (!orgId) redirect(`${closeHref()}&error=${encodeURIComponent("org not found")}`);

  const min_score = parseIntSafe(formData.get("min_score"));
  const max_score = parseIntSafe(formData.get("max_score"));
  const mapped_category = String(formData.get("mapped_category") || "").trim();
  const suppression = String(formData.get("suppression") || "").trim() === "true";
  const probability_modifier = parseNumSafe(formData.get("probability_modifier"));

  if (min_score == null || max_score == null) redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("min/max score are required")}`);
  if (min_score > max_score) redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("min_score cannot exceed max_score")}`);
  if (!mapped_category) redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("mapped_category is required")}`);
  if (!CATEGORY_OPTIONS.includes(mapped_category as any)) {
    redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("mapped_category must be Commit, Best Case, or Pipeline")}`);
  }
  if (probability_modifier == null || probability_modifier < 0 || probability_modifier > 9.9999) {
    redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("probability_modifier must be between 0 and 9.9999")}`);
  }

  if (mode === "edit") {
    const id = parseIntSafe(idRaw);
    if (!id) redirect(`${closeHref(orgPublicId)}&error=${encodeURIComponent("id is required")}`);
    await pool.query(
      `
      UPDATE health_score_rules
         SET min_score = $3::int,
             max_score = $4::int,
             mapped_category = $5::varchar(50),
             suppression = $6::bool,
             probability_modifier = $7::numeric(5,4),
             updated_at = NOW()
       WHERE org_id = $1::int
         AND id = $2::int
      `,
      [orgId, id, min_score, max_score, mapped_category, suppression, probability_modifier]
    );
  } else {
    await pool.query(
      `
      INSERT INTO health_score_rules (org_id, min_score, max_score, mapped_category, suppression, probability_modifier, created_at, updated_at)
      VALUES ($1::int, $2::int, $3::int, $4::varchar(50), $5::bool, $6::numeric(5,4), NOW(), NOW())
      `,
      [orgId, min_score, max_score, mapped_category, suppression, probability_modifier]
    );
  }

  revalidatePath("/admin/organizations/health-score-rules");
  redirect(`${closeHref(orgPublicId)}&saved=1`);
}

async function resetDefaultsAction(formData: FormData) {
  "use server";
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const orgPublicId = String(formData.get("org_public_id") || "").trim();
  if (!orgPublicId) redirect(closeHref());
  const orgId = await resolvePublicId("organizations", orgPublicId).catch(() => 0);
  if (!orgId) redirect(closeHref());

  await pool.query(`DELETE FROM health_score_rules WHERE org_id = $1::int`, [orgId]);
  await pool.query(
    `
    INSERT INTO health_score_rules (org_id, min_score, max_score, mapped_category, suppression, probability_modifier, created_at, updated_at)
    VALUES
      ($1::int, 27, 30, 'Commit', false, 1.0, NOW(), NOW()),
      ($1::int, 24, 26, 'Commit', false, 0.9, NOW(), NOW()),
      ($1::int, 21, 23, 'Commit', false, 0.87, NOW(), NOW()),
      ($1::int, 0, 20, 'Commit', false, 0.85, NOW(), NOW()),
      ($1::int, 21, 23, 'Best Case', false, 1.0, NOW(), NOW()),
      ($1::int, 18, 20, 'Best Case', true, 0.0, NOW(), NOW()),
      ($1::int, 0, 17, 'Pipeline', false, 1.0, NOW(), NOW())
    `,
    [orgId]
  );

  revalidatePath("/admin/organizations/health-score-rules");
  redirect(`${closeHref(orgPublicId)}&saved=1`);
}

async function deleteRuleAction(formData: FormData) {
  "use server";
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const orgPublicId = String(formData.get("org_public_id") || "").trim();
  const id = parseIntSafe(formData.get("id"));
  if (!orgPublicId || !id) redirect(closeHref());
  const orgId = await resolvePublicId("organizations", orgPublicId).catch(() => 0);
  if (!orgId) redirect(closeHref());

  await pool.query(`DELETE FROM health_score_rules WHERE org_id = $1::int AND id = $2::int`, [orgId, id]);
  revalidatePath("/admin/organizations/health-score-rules");
  redirect(`${closeHref(orgPublicId)}&saved=1`);
}

function overlaps(a: RuleRow, b: RuleRow) {
  // Overlaps only matter *within the same mapped category*.
  // Different categories are filtered at usage-time (e.g. Commit vs Best Case vs Pipeline),
  // so cross-category overlaps are expected and not ambiguous.
  if (String(a.mapped_category || "").trim() !== String(b.mapped_category || "").trim()) return false;
  const lo = Math.max(Number(a.min_score), Number(b.min_score));
  const hi = Math.min(Number(a.max_score), Number(b.max_score));
  return lo <= hi;
}

export default async function HealthScoreRulesAdminPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await requireAuth();
  if (ctx.kind !== "master") redirect("/admin");

  const orgPublicId = String(sp(searchParams.org) || "").trim();
  const modal = String(sp(searchParams.modal) || "").trim(); // new | edit | delete
  const ruleIdRaw = String(sp(searchParams.id) || "").trim();
  const error = String(sp(searchParams.error) || "").trim();
  const saved = String(sp(searchParams.saved) || "").trim() === "1";

  const orgs = await listOrganizations({ activeOnly: false }).catch(() => []);
  const orgId = orgPublicId ? await resolvePublicId("organizations", orgPublicId).catch(() => 0) : 0;
  const org = orgId ? orgs.find((o) => o.id === orgId) || null : null;

  const rules: RuleRow[] = orgId
    ? await pool
        .query<RuleRow>(
          `
          SELECT
            id,
            org_id,
            min_score,
            max_score,
            mapped_category,
            suppression,
            probability_modifier,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM health_score_rules
          WHERE org_id = $1::int
          ORDER BY min_score ASC, max_score ASC, id ASC
          `,
          [orgId]
        )
        .then((r) => r.rows || [])
        .catch(() => [])
    : [];

  const currentRuleId = parseIntSafe(ruleIdRaw);
  const currentRule = (modal === "edit" || modal === "delete") && currentRuleId ? rules.find((r) => Number(r.id) === Number(currentRuleId)) || null : null;

  const overlapPairs = (() => {
    const out: Array<[RuleRow, RuleRow]> = [];
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if (overlaps(rules[i], rules[j])) out.push([rules[i], rules[j]]);
      }
    }
    return out;
  })();

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Health score rules</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Manage per-organization ranges in <span className="font-mono text-xs">health_score_rules</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/organizations" className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
            Organizations
          </Link>
          <Link href="/admin/organizations?modal=new" className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
            New org
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-[#E74C3C]/40 bg-[#E74C3C]/10 p-3 text-sm text-[#E74C3C]">{error}</div>
      ) : null}
      {saved ? (
        <div className="mt-4 rounded-md border border-[#2ECC71]/40 bg-[#2ECC71]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">Saved.</div>
      ) : null}

      <section className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Organization</h2>
        <form method="GET" action="/admin/organizations/health-score-rules" className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="grid gap-1 md:col-span-2">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Select org</label>
            <select
              name="org"
              defaultValue={orgPublicId}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              required
            >
              <option value="">(select)</option>
              {orgs.map((o) => (
                <option key={o.public_id} value={String(o.public_id)}>
                  {o.name} ({o.public_id})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end justify-end gap-2">
            <Link href={closeHref()} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
              Reset
            </Link>
            <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
              Load
            </button>
          </div>
        </form>
      </section>

      {!org ? (
        <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <p className="text-sm text-[color:var(--sf-text-secondary)]">Select an organization to view and edit its health score rules.</p>
        </section>
      ) : (
        <>
          <section className="mt-5 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Defaults</h2>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Use defaults to avoid typos and to match standard forecasting categories. This will replace all existing rules for this org.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
              <div className="text-sm text-[color:var(--sf-text-primary)]">
                <div className="font-semibold">Default ranges</div>
                <div className="mt-1 text-xs text-[color:var(--sf-text-secondary)] font-mono">
                  27–30 Commit (1.0) · 24–26 Commit (0.9) · 21–23 Commit (0.87) · 0–20 Commit (0.85) · 21–23 Best Case (1.0) · 18–20 Best Case (suppressed, 0.0) · 0–17 Pipeline (1.0)
                </div>
              </div>
              <Link
                href={`${closeHref(orgPublicId)}&modal=defaults`}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reset to defaults
              </Link>
            </div>
          </section>

          {overlapPairs.length ? (
            <section className="mt-5 rounded-xl border border-[#F1C40F]/40 bg-[#F1C40F]/10 p-5 shadow-sm">
              <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Warning: overlapping ranges</div>
              <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                Some rules overlap for <span className="font-semibold">{org.name}</span>. This can create ambiguous mappings.
              </p>
              <div className="mt-3 grid gap-2 text-xs text-[color:var(--sf-text-primary)]">
                {overlapPairs.slice(0, 12).map(([a, b]) => (
                  <div key={`${a.id}:${b.id}`} className="font-mono">
                    #{a.id} [{a.min_score}–{a.max_score}] overlaps #{b.id} [{b.min_score}–{b.max_score}]
                  </div>
                ))}
                {overlapPairs.length > 12 ? (
                  <div className="text-[color:var(--sf-text-secondary)]">…and {overlapPairs.length - 12} more</div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="mt-5 overflow-auto rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--sf-border)] p-4">
              <div>
                <div className="text-base font-semibold text-[color:var(--sf-text-primary)]">Rules</div>
                <div className="mt-0.5 text-sm text-[color:var(--sf-text-secondary)]">
                  Org: <span className="font-medium">{org.name}</span> · {rules.length} rule(s)
                </div>
              </div>
              <Link
                href={`${closeHref(orgPublicId)}&modal=new`}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
              >
                New rule
              </Link>
            </div>

            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-4 py-3">id</th>
                  <th className="px-4 py-3">min</th>
                  <th className="px-4 py-3">max</th>
                  <th className="px-4 py-3">mapped_category</th>
                  <th className="px-4 py-3">suppression</th>
                  <th className="px-4 py-3">probability_modifier</th>
                  <th className="px-4 py-3">updated_at</th>
                  <th className="px-4 py-3 text-right">actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.length ? (
                  rules.map((r) => (
                    <tr key={r.id} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.min_score}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.max_score}</td>
                      <td className="px-4 py-3">{r.mapped_category}</td>
                      <td className="px-4 py-3">{r.suppression ? "true" : "false"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.probability_modifier == null ? "—" : String(r.probability_modifier)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[color:var(--sf-text-secondary)]">{String(r.updated_at || "")}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`${closeHref(orgPublicId)}&modal=edit&id=${encodeURIComponent(String(r.id))}`}
                            className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
                          >
                            Edit
                          </Link>
                          <Link
                            href={`${closeHref(orgPublicId)}&modal=delete&id=${encodeURIComponent(String(r.id))}`}
                            className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)]"
                          >
                            Delete
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--sf-text-disabled)]">
                      No rules found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {modal === "new" && org ? (
        <Modal title="New health score rule" closeHref={closeHref(orgPublicId)}>
          <form action={upsertRuleAction} className="grid gap-3">
            <input type="hidden" name="mode" value="new" />
            <input type="hidden" name="org_public_id" value={orgPublicId} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">min_score</label>
                <input name="min_score" type="number" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono" required />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">max_score</label>
                <input name="max_score" type="number" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono" required />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">mapped_category</label>
              <select
                name="mapped_category"
                defaultValue="Commit"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">suppression</label>
                <select name="suppression" defaultValue="false" className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm">
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">probability_modifier</label>
                <input
                  name="probability_modifier"
                  type="number"
                  step="0.0001"
                  defaultValue="1.0"
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono"
                  required
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref(orgPublicId)} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Create
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "edit" && org && currentRule ? (
        <Modal title={`Edit rule #${currentRule.id}`} closeHref={closeHref(orgPublicId)}>
          <form action={upsertRuleAction} className="grid gap-3">
            <input type="hidden" name="mode" value="edit" />
            <input type="hidden" name="org_public_id" value={orgPublicId} />
            <input type="hidden" name="id" value={String(currentRule.id)} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">min_score</label>
                <input
                  name="min_score"
                  type="number"
                  defaultValue={String(currentRule.min_score)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono"
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">max_score</label>
                <input
                  name="max_score"
                  type="number"
                  defaultValue={String(currentRule.max_score)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono"
                  required
                />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">mapped_category</label>
              <select
                name="mapped_category"
                defaultValue={CATEGORY_OPTIONS.includes(currentRule.mapped_category as any) ? (currentRule.mapped_category as CategoryOption) : "Pipeline"}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">suppression</label>
                <select
                  name="suppression"
                  defaultValue={currentRule.suppression ? "true" : "false"}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">probability_modifier</label>
                <input
                  name="probability_modifier"
                  type="number"
                  step="0.0001"
                  defaultValue={currentRule.probability_modifier == null ? "1.0" : String(currentRule.probability_modifier)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono"
                  required
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Link href={closeHref(orgPublicId)} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Save
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "delete" && org && currentRule ? (
        <Modal title={`Delete rule #${currentRule.id}`} closeHref={closeHref(orgPublicId)}>
          <form action={deleteRuleAction} className="grid gap-4">
            <input type="hidden" name="org_public_id" value={orgPublicId} />
            <input type="hidden" name="id" value={String(currentRule.id)} />
            <div className="rounded-md border border-[#E74C3C]/40 bg-[#E74C3C]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
              <div className="font-semibold text-[#E74C3C]">This action cannot be undone.</div>
              <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                Delete range <span className="font-mono text-xs">{currentRule.min_score}–{currentRule.max_score}</span> for{" "}
                <span className="font-semibold">{org.name}</span>.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Link href={closeHref(orgPublicId)} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
                Cancel
              </Link>
              <button className="rounded-md bg-[#E74C3C] px-3 py-2 text-sm font-medium text-white hover:opacity-90">Delete</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {modal === "defaults" && org ? (
        <Modal title="Reset to defaults" closeHref={closeHref(orgPublicId)}>
          <form action={resetDefaultsAction} className="grid gap-4">
            <input type="hidden" name="org_public_id" value={orgPublicId} />
            <div className="rounded-md border border-[#F1C40F]/40 bg-[#F1C40F]/10 p-3 text-sm text-[color:var(--sf-text-primary)]">
              <div className="font-semibold">This will replace all existing rules.</div>
              <div className="mt-1 text-[color:var(--sf-text-secondary)]">
                Defaults:
                <div className="mt-2 grid gap-1 font-mono text-xs">
                  <div>27–30 → Commit · modifier 1.0</div>
                  <div>24–26 → Commit · modifier 0.9</div>
                  <div>21–23 → Commit · modifier 0.87</div>
                  <div>0–20 → Commit · modifier 0.85</div>
                  <div>21–23 → Best Case · modifier 1.0</div>
                  <div>18–20 → Best Case · suppression true · modifier 0.0</div>
                  <div>0–17 → Pipeline · modifier 1.0</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Link href={closeHref(orgPublicId)} className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]">
                Cancel
              </Link>
              <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
                Reset
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

