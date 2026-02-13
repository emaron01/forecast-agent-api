import type { QuotaPeriodRow, QuotaRow } from "../../lib/quotaModels";

export function QuotaEditor(args: {
  action: (formData: FormData) => void | Promise<void>;
  periods: QuotaPeriodRow[];
  reps: Array<{ id: number; rep_name: string | null }>;
  defaultMode: "rep" | "manager" | "vp" | "cro";
  returnTo?: string;
  quota?: QuotaRow | null;
}) {
  const { action, periods, reps, defaultMode, returnTo, quota } = args;
  const mode = defaultMode;
  const isEdit = !!quota?.id;
  return (
    <form action={action} className="grid gap-3">
      {isEdit ? <input type="hidden" name="id" value={String(quota?.id || "")} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div className="grid gap-1">
        <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_period_id</label>
        <select
          name="quota_period_id"
          defaultValue={String(quota?.quota_period_id || "")}
          className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          required
        >
          <option value="">(select)</option>
          {periods.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.period_name} ({p.id})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">role_level</label>
          <input
            name="role_level"
            defaultValue={String(quota?.role_level ?? (mode === "cro" ? 0 : mode === "vp" ? 1 : mode === "manager" ? 2 : 3))}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
            required
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">rep_id</label>
          <select
            name="rep_id"
            defaultValue={String(quota?.rep_id || "")}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          >
            <option value="">(none)</option>
            {reps.map((r) => (
              <option key={String(r.id)} value={String(r.id)}>
                {String(r.rep_name || "")} ({r.id})
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">manager_id</label>
          <select
            name="manager_id"
            defaultValue={String(quota?.manager_id || "")}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
          >
            <option value="">(none)</option>
            {reps.map((r) => (
              <option key={String(r.id)} value={String(r.id)}>
                {String(r.rep_name || "")} ({r.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">quota_amount</label>
          <input
            name="quota_amount"
            defaultValue={quota ? String(quota.quota_amount) : ""}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
            required
          />
        </div>
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">annual_target</label>
          <input
            name="annual_target"
            defaultValue={quota?.annual_target == null ? "" : String(quota.annual_target)}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">carry_forward</label>
          <input
            name="carry_forward"
            defaultValue={quota?.carry_forward == null ? "" : String(quota.carry_forward)}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">adjusted_quarterly_quota</label>
          <input
            name="adjusted_quarterly_quota"
            defaultValue={quota?.adjusted_quarterly_quota == null ? "" : String(quota.adjusted_quarterly_quota)}
            className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm font-mono text-[color:var(--sf-text-primary)]"
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <button className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]">
          {isEdit ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

