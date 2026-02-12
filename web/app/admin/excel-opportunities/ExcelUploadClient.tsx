"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import * as XLSX from "xlsx";

type MappingSet = { public_id: string; name: string; source_system: string | null };
type FieldMapping = { source_field: string; target_field: string };

type ActionState =
  | {
      ok: true;
      kind: "success";
      message: string;
      mappingSetPublicId?: string;
      mappingSetName?: string;
      inserted?: number; // rows staged
      changed?: number; // opportunities changed (processed)
      processed?: number;
      error?: number;
      intent: string;
      ts: number;
    }
  | { ok: false; kind: "error"; message: string; issues: string[]; intent: string; ts: number }
  | undefined;

const TARGETS: Array<{ key: TargetField; label: string; required?: boolean }> = [
  { key: "account_name", label: "Account", required: true },
  { key: "opportunity_name", label: "Opportunity Name", required: true },
  { key: "amount", label: "Revenue (Amount)", required: true },
  { key: "rep_name", label: "Account Owner", required: true },
  { key: "product", label: "Product (optional)" },
  { key: "sales_stage", label: "Sales Stage" },
  { key: "forecast_stage", label: "Forecast Stage" },
  { key: "crm_opp_id", label: "CRM Opportunity ID", required: true },
  { key: "create_date_raw", label: "Create Date", required: true },
  { key: "close_date", label: "Close Date", required: true },
];

type TargetField =
  | "account_name"
  | "opportunity_name"
  | "amount"
  | "rep_name"
  | "product"
  | "sales_stage"
  | "forecast_stage"
  | "crm_opp_id"
  | "create_date_raw"
  | "close_date";

function norm(s: string) {
  return String(s || "").trim().toLowerCase();
}

function guessMapping(headers: string[]) {
  const h = headers;
  const pick = (pred: (s: string) => boolean) => h.find((x) => pred(norm(x))) || "";

  return {
    account_name: pick((s) => s === "account" || s.includes("account name") || s === "company" || s === "customer"),
    opportunity_name: pick((s) => s === "opportunity" || s.includes("opportunity name") || s === "deal" || s.includes("deal name")),
    amount: pick((s) => s === "amount" || s.includes("revenue") || s.includes("arr") || s.includes("acv") || s.includes("value")),
    rep_name: pick((s) => s.includes("owner") || s.includes("account owner") || s.includes("rep") || s.includes("sales rep")),
    product: pick((s) => s === "product" || s.includes("product name") || s.includes("product_line") || s.includes("product line")),
    sales_stage: pick((s) => s === "stage" || s.includes("sales stage") || s === "sales_stage"),
    forecast_stage: pick((s) => s.includes("forecast stage") || s.includes("forecast category") || s.includes("forecast")),
    crm_opp_id: pick((s) => s.includes("crm") && s.includes("id")) || pick((s) => s === "id" || s.includes("opportunity id")),
    create_date_raw: pick(
      (s) =>
        s === "create date" ||
        s === "created date" ||
        s === "created at" ||
        s === "createdat" ||
        s === "created_at" ||
        s === "created on" ||
        s === "create_date"
    ),
    close_date: pick(
      (s) =>
        s === "close date" ||
        s === "closedate" ||
        s === "close_date" ||
        (s.includes("close") && s.includes("date")) ||
        s === "expected close" ||
        s === "expected close date"
    ),
  } satisfies Record<TargetField, string>;
}

function SubmitButton(props: {
  name: string;
  value: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const { pending } = useFormStatus();
  const variant = props.variant || "secondary";
  const base = "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 transition";
  const cls =
    variant === "primary"
      ? `${base} bg-[color:var(--sf-button-primary-bg)] text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] ${
          props.active && pending ? "bg-[color:var(--sf-button-primary-hover)]" : ""
        }`
      : variant === "danger"
        ? `${base} border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] text-[#E74C3C] hover:bg-[color:var(--sf-surface)] ${
            props.active && pending ? "bg-[color:var(--sf-surface)]" : ""
          }`
        : `${base} border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] ${
            props.active && pending ? "bg-[color:var(--sf-surface)]" : ""
          }`;
  return (
    <button
      type="submit"
      name={props.name}
      value={props.value}
      className={cls}
      disabled={pending || !!props.disabled}
      onClick={props.onClick}
    >
      {pending ? "Working…" : props.children}
    </button>
  );
}

export function ExcelUploadClient(props: {
  mappingSets: MappingSet[];
  prefillSetPublicId: string;
  prefillMappings: FieldMapping[];
  action: (prevState: any, formData: FormData) => Promise<any>;
}) {
  const [mode, setMode] = useState<"existing" | "new">(props.prefillSetPublicId ? "existing" : "existing");
  const [mappingSetPublicId, setMappingSetPublicId] = useState(props.prefillSetPublicId || "");
  const [mappingSetName, setMappingSetName] = useState("");
  const [localSavedSet, setLocalSavedSet] = useState<{ public_id: string; name: string } | null>(null);

  const prefillByTarget = useMemo(() => {
    const m: Partial<Record<TargetField, string>> = {};
    for (const fm of props.prefillMappings || []) {
      m[fm.target_field as TargetField] = fm.source_field;
    }
    return m;
  }, [props.prefillMappings]);

  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>(prefillByTarget);
  const [fileName, setFileName] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [dismissedBannerKey, setDismissedBannerKey] = useState<number | null>(null);
  const [clickedIntent, setClickedIntent] = useState<null | "save_format" | "delete_format" | "upload_ingest">(null);
  const [formatLoading, setFormatLoading] = useState(false);
  const [formatReloadKey, setFormatReloadKey] = useState(0);

  const mappingJson = useMemo(() => JSON.stringify(mapping || {}), [mapping]);

  const [actionState, formAction] = useFormState(props.action as any, undefined);
  const state = actionState as ActionState;

  useEffect(() => {
    if (!state || state.kind !== "success") return;
    if (state.intent === "save_format" && state.mappingSetPublicId) {
      const name = state.mappingSetName || mappingSetName || "New format";
      setLocalSavedSet({ public_id: state.mappingSetPublicId, name });
      setMappingSetPublicId(state.mappingSetPublicId);
      setMode("existing");
      setFormatReloadKey((x) => x + 1);
    }
    if (state.intent === "delete_format" && state.mappingSetPublicId) {
      if (mappingSetPublicId === state.mappingSetPublicId) setMappingSetPublicId("");
      setFormatReloadKey((x) => x + 1);
    }
  }, [state, mappingSetName]);

  useEffect(() => {
    // Reset pressed-state after a response returns.
    if (!state) return;
    setClickedIntent(null);
  }, [state?.ts]);

  // When selecting a saved format, fetch and apply its stored mappings.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const pid = String(mappingSetPublicId || "").trim();
      if (!pid) return;
      setFormatLoading(true);
      try {
        const res = await fetch(`/api/mappings/list?mappingSetPublicId=${encodeURIComponent(pid)}`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) return;
        const fms = Array.isArray(data.fieldMappings) ? data.fieldMappings : [];
        const saved: Partial<Record<TargetField, string>> = {};
        for (const fm of fms) {
          const rawTarget = String(fm?.target_field || "").trim();
          const target_field = (rawTarget === "stage" ? "sales_stage" : rawTarget) as TargetField;
          // IMPORTANT: Do NOT trim source_field; it must match Excel header keys exactly.
          const source_field = String(fm?.source_field ?? "");
          if (!target_field || !source_field) continue;
          (saved as any)[target_field] = source_field;
        }
        if (cancelled) return;
        setMapping((prev) => ({ ...prev, ...saved }));
      } finally {
        if (!cancelled) setFormatLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mappingSetPublicId, formatReloadKey]);

  function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (!data) return;
      const wb = XLSX.read(data, { type: "array" });
      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) return;
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as any[];
      const keys = rows.length ? Object.keys(rows[0] || {}) : [];
      setHeaders(keys);
      setPreview(rows.slice(0, 5));

      // If we don't have a mapping yet, guess it.
      setMapping((prev) => {
        const merged = { ...guessMapping(keys), ...prev };
        // If a saved mapping exists, keep it.
        for (const [k, v] of Object.entries(prefillByTarget)) {
          if (v) (merged as any)[k] = v;
        }
        return merged;
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function reset() {
    setFileName("");
    setHeaders([]);
    setPreview([]);
    setFileInputKey((k) => k + 1);
    if (state?.ts != null) setDismissedBannerKey(state.ts);
  }

  const effectiveSets = useMemo(() => {
    const base = props.mappingSets || [];
    if (!localSavedSet) return base;
    if (base.some((s) => s.public_id === localSavedSet.public_id)) return base;
    return [{ public_id: localSavedSet.public_id, name: `${localSavedSet.name} (just saved)`, source_system: "excel-opportunities" }, ...base];
  }, [props.mappingSets, localSavedSet]);

  const showBanner = !!state && state.ts !== dismissedBannerKey;

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Upload + map Excel</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Upload an Excel file (.xlsx) of opportunities, map columns to Forecast Agent fields, and save the format for future uploads.
        </p>

        {showBanner ? (
          <div
            className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
              state?.kind === "success"
                ? "border-[#2ECC71] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
                : "border-[#F1C40F] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{state?.kind === "success" ? state.message : state?.message || "Fix this:"}</div>
                {state && state.kind === "error" && state.issues?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {state.issues.slice(0, 25).map((x, idx) => (
                      <li key={idx}>{x}</li>
                    ))}
                  </ul>
                ) : null}
                {state && state.kind === "success" && state.intent === "upload_ingest" ? (
                  <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">
                    {state.mappingSetPublicId ? (
                      <span>
                        Format: <span className="font-mono">{state.mappingSetPublicId}</span>
                      </span>
                    ) : null}
                    {typeof state.inserted === "number" ? <span className="ml-2">Rows staged: {state.inserted}</span> : null}
                    {typeof state.changed === "number" ? <span className="ml-2">Records changed: {state.changed}</span> : null}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="text-xs font-medium opacity-80 hover:opacity-100"
                onClick={() => setDismissedBannerKey(state?.ts ?? null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <form action={formAction} className="mt-4 grid gap-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Format</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode("existing")}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    mode === "existing"
                      ? "border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-[color:var(--sf-button-primary-text)]"
                      : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
                  }`}
                >
                  Use saved
                </button>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    mode === "new"
                      ? "border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-accent-primary)] text-[color:var(--sf-button-primary-text)]"
                      : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
                  }`}
                >
                  Create new
                </button>
              </div>
            </div>

            {mode === "existing" ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Saved format</label>
                <select
                  name="mapping_set_public_id"
                  value={mappingSetPublicId}
                  onChange={(e) => setMappingSetPublicId(e.target.value)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                >
                  <option value="">Select…</option>
                  {effectiveSets.map((s) => (
                    <option key={s.public_id} value={s.public_id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {formatLoading ? <div className="text-xs text-[color:var(--sf-text-disabled)]">Loading format…</div> : null}
              </div>
            ) : (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">New format name</label>
                <input
                  name="mappingSetName"
                  value={mappingSetName}
                  onChange={(e) => setMappingSetName(e.target.value)}
                  className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                  placeholder="Acme - Opportunities Excel"
                />
              </div>
            )}
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Excel file (.xlsx)</label>
            <input
              key={fileInputKey}
              name="file"
              type="file"
              accept=".xlsx,.xls"
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
            {fileName ? <p className="text-xs text-[color:var(--sf-text-disabled)]">Selected: {fileName}</p> : null}
          </div>

          <input type="hidden" name="mappingJson" value={mappingJson} />
          <input type="hidden" name="processNow" value="true" />

          <div className="rounded-lg border border-[color:var(--sf-border)] p-4">
            <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">Field mapping</div>
            <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Choose which Excel column maps to each target field.</p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {TARGETS.map((t) => (
                <div key={t.key} className="grid gap-1">
                  <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">
                    {t.label} {t.required ? <span className="text-[#E74C3C]">*</span> : null}
                  </label>
                  <select
                    value={(mapping as any)[t.key] || ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [t.key]: e.target.value || "" }))}
                    className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                    disabled={!headers.length}
                  >
                    <option value="">{headers.length ? "(none)" : "Upload a file first…"}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
            >
              Reset
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {mode === "existing" && mappingSetPublicId ? (
                <>
                  <SubmitButton
                    name="intent"
                    value="save_format"
                    variant="secondary"
                    disabled={!headers.length}
                    active={clickedIntent === "save_format"}
                    onClick={() => setClickedIntent("save_format")}
                  >
                    Update format
                  </SubmitButton>
                  <SubmitButton
                    name="intent"
                    value="delete_format"
                    variant="danger"
                    disabled={!mappingSetPublicId}
                    active={clickedIntent === "delete_format"}
                    onClick={() => setClickedIntent("delete_format")}
                  >
                    Delete format
                  </SubmitButton>
                </>
              ) : null}
              {mode === "new" ? (
                <SubmitButton
                  name="intent"
                  value="save_format"
                  variant="secondary"
                  disabled={!headers.length || !mappingSetName.trim()}
                  active={clickedIntent === "save_format"}
                  onClick={() => setClickedIntent("save_format")}
                >
                  Save new format
                </SubmitButton>
              ) : null}
              <SubmitButton
                name="intent"
                value="upload_ingest"
                variant="primary"
                disabled={!headers.length}
                active={clickedIntent === "upload_ingest"}
                onClick={() => setClickedIntent("upload_ingest")}
              >
                Upload + ingest
              </SubmitButton>
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Preview</h2>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">First 5 rows from the first sheet.</p>

        {preview.length ? (
          <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, idx) => (
                  <tr key={idx} className="border-t border-[color:var(--sf-border)]">
                    {headers.map((h) => (
                      <td key={h} className="px-3 py-2 whitespace-nowrap">
                        {r?.[h] == null ? "" : String(r[h])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 text-sm text-[color:var(--sf-text-secondary)]">Upload an Excel file to see a preview.</div>
        )}
      </section>
    </div>
  );
}

