"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type MappingSet = { public_id: string; name: string; source_system: string | null };
type FieldMapping = { source_field: string; target_field: string };

const TARGETS: Array<{ key: TargetField; label: string; required?: boolean }> = [
  { key: "account_name", label: "Account", required: true },
  { key: "opportunity_name", label: "Opportunity Name", required: true },
  { key: "amount", label: "Revenue (Amount)", required: true },
  { key: "rep_name", label: "Account Owner", required: true },
  { key: "stage", label: "Sales Stage" },
  { key: "forecast_stage", label: "Forecast Stage" },
  { key: "crm_opp_id", label: "CRM Opportunity ID (optional)" },
];

type TargetField = "account_name" | "opportunity_name" | "amount" | "rep_name" | "stage" | "forecast_stage" | "crm_opp_id";

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
    stage: pick((s) => s === "stage" || s.includes("sales stage")),
    forecast_stage: pick((s) => s.includes("forecast stage") || s.includes("forecast category") || s.includes("forecast")),
    crm_opp_id: pick((s) => s.includes("crm") && s.includes("id")) || pick((s) => s === "id" || s.includes("opportunity id")),
  } satisfies Record<TargetField, string>;
}

export function ExcelUploadClient(props: {
  mappingSets: MappingSet[];
  prefillSetPublicId: string;
  prefillMappings: FieldMapping[];
  action: (formData: FormData) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(props.prefillSetPublicId ? "existing" : "existing");
  const [mappingSetPublicId, setMappingSetPublicId] = useState(props.prefillSetPublicId || "");
  const [mappingSetName, setMappingSetName] = useState("");

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

  const mappingJson = useMemo(() => JSON.stringify(mapping || {}), [mapping]);

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

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Upload + map Excel</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload an Excel file (.xlsx) of opportunities, map columns to Forecast Agent fields, and save the format for future uploads.
        </p>

        <form action={props.action} className="mt-4 grid gap-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-slate-700">Format</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMode("existing")}
                  className={`rounded-md border px-3 py-2 text-sm ${mode === "existing" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
                >
                  Use saved
                </button>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className={`rounded-md border px-3 py-2 text-sm ${mode === "new" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
                >
                  Create new
                </button>
              </div>
            </div>

            {mode === "existing" ? (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">Saved format</label>
                <select
                  name="mapping_set_public_id"
                  value={mappingSetPublicId}
                  onChange={(e) => setMappingSetPublicId(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select…</option>
                  {props.mappingSets.map((s) => (
                    <option key={s.public_id} value={s.public_id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid gap-1">
                <label className="text-sm font-medium text-slate-700">New format name</label>
                <input
                  name="mappingSetName"
                  value={mappingSetName}
                  onChange={(e) => setMappingSetName(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Acme - Opportunities Excel"
                  required
                />
              </div>
            )}
          </div>

          <div className="grid gap-1">
            <label className="text-sm font-medium text-slate-700">Excel file (.xlsx)</label>
            <input
              name="file"
              type="file"
              accept=".xlsx,.xls"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
              required
            />
            {fileName ? <p className="text-xs text-slate-500">Selected: {fileName}</p> : null}
          </div>

          <input type="hidden" name="mappingJson" value={mappingJson} />
          <input type="hidden" name="processNow" value="true" />

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-medium text-slate-900">Field mapping</div>
            <p className="mt-1 text-xs text-slate-600">Choose which Excel column maps to each target field.</p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {TARGETS.map((t) => (
                <div key={t.key} className="grid gap-1">
                  <label className="text-sm font-medium text-slate-700">
                    {t.label} {t.required ? <span className="text-rose-600">*</span> : null}
                  </label>
                  <select
                    value={(mapping as any)[t.key] || ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [t.key]: e.target.value || "" }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    disabled={!headers.length}
                    required={!!t.required}
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

          <div className="flex items-center justify-end">
            <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white" disabled={!headers.length}>
              Upload + ingest
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Preview</h2>
        <p className="mt-1 text-sm text-slate-600">First 5 rows from the first sheet.</p>

        {preview.length ? (
          <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
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
                  <tr key={idx} className="border-t border-slate-100">
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
          <div className="mt-4 text-sm text-slate-600">Upload an Excel file to see a preview.</div>
        )}
      </section>
    </div>
  );
}

