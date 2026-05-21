"use client";

import { useCallback, useEffect, useState } from "react";

type Conn = {
  sf_org_id: string | null;
  sf_domain: string | null;
  instance_url: string | null;
  sandbox: boolean;
  connected_at: string | null;
  last_synced_at: string | null;
  writeback_enabled: boolean;
  api_version: string | null;
} | null;

type SavedMap = {
  sf_field: string;
  sfdc_api_name: string | null;
  confidence: string;
};

type WritebackFieldKey = "health_initial" | "health_current" | "risk_summary" | "next_steps";

type WritebackMappingRow = {
  sf_field: WritebackFieldKey;
  sfdc_api_name: string | null;
};

const SF_LABELS: Record<string, string> = {
  deal_name:      "Opportunity Name",
  amount:         "Revenue (Amount)",
  close_date:     "Close Date",
  stage:          "Sales Stage",
  owner:          "Account Owner",
  forecast_stage: "Forecast Category (optional)",
  product:        "Product (optional)",
  partner_name:   "Partner Name (optional)",
  deal_reg:       "Deal Registration (optional)",
  deal_reg_date:  "Deal Registration Date (optional)",
  deal_reg_id:    "Deal Registration ID / Number (optional)",
};

// Default SFDC API field names shown as placeholders
const SF_DEFAULTS: Record<string, string> = {
  deal_name:      "Name",
  amount:         "Amount",
  close_date:     "CloseDate",
  stage:          "StageName",
  owner:          "OwnerId",
  forecast_stage: "ForecastCategoryName",
};

// Placeholder hints for optional fields with no standard SFDC equivalent
const SF_PLACEHOLDERS: Record<string, string> = {
  product:       "Deal-level field e.g. Primary_Product__c (ask your SFDC admin to create a formula field on Opportunity referencing the primary product name)",
  partner_name:  "Custom field e.g. Partner_Name__c",
  deal_reg:      "Custom field e.g. Deal_Registration__c",
  deal_reg_date: "Custom field e.g. Deal_Reg_Date__c",
  deal_reg_id:   "Custom field e.g. Deal_Reg_ID__c",
};

const WRITEBACK_FIELDS: Array<{
  sf_field: WritebackFieldKey;
  label: string;
  description: string;
  defaultApiName: string;
  fieldType: string;
}> = [
  {
    sf_field: "health_initial",
    label: "Initial Health Score",
    description: "Written once when Matthew first reviews this opportunity. Never overwritten.",
    defaultApiName: "SF_Health_Score_Initial__c",
    fieldType: "Number(3, 0)",
  },
  {
    sf_field: "health_current",
    label: "Current Health Score",
    description: "Updated after every Matthew review.",
    defaultApiName: "SF_Health_Score_Current__c",
    fieldType: "Number(3, 0)",
  },
  {
    sf_field: "risk_summary",
    label: "Risk Summary",
    description: "Matthew's narrative risk assessment.",
    defaultApiName: "SF_Risk_Summary__c",
    fieldType: "Long Text Area(32768)",
  },
  {
    sf_field: "next_steps",
    label: "Next Steps",
    description: "Matthew's recommended next steps.",
    defaultApiName: "SF_Next_Steps__c",
    fieldType: "Long Text Area(32768)",
  },
];

function defaultWritebackRows(): Record<WritebackFieldKey, WritebackMappingRow> {
  return {
    health_initial: { sf_field: "health_initial", sfdc_api_name: "SF_Health_Score_Initial__c" },
    health_current: { sf_field: "health_current", sfdc_api_name: "SF_Health_Score_Current__c" },
    risk_summary:   { sf_field: "risk_summary",   sfdc_api_name: "SF_Risk_Summary__c" },
    next_steps:     { sf_field: "next_steps",     sfdc_api_name: "SF_Next_Steps__c" },
  };
}

export function SalesforceIntegrationClient(props: {
  orgId: number;
  connection: Conn;
  mappingsComplete: boolean;
  initialSyncComplete: boolean;
  savedMappings: SavedMap[];
}) {
  const [connection, setConnection] = useState<Conn>(props.connection);
  const [connectedAtText, setConnectedAtText] = useState("—");
  const [lastSyncedAtText, setLastSyncedAtText] = useState("—");
  const [mappingsComplete, setMappingsComplete] = useState(props.mappingsComplete);
  const [initialSyncComplete, setInitialSyncComplete] = useState(props.initialSyncComplete);
  const [rows, setRows] = useState<Record<string, { sfdc_api_name: string | null; confidence: string }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [layoutEditEnabled, setLayoutEditEnabled] = useState(!props.mappingsComplete);
  const [layoutSavedFlash, setLayoutSavedFlash] = useState("");
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [writeback, setWriteback] = useState(!!props.connection?.writeback_enabled);
  const [poll, setPoll] = useState(false);
  const [writebackRows, setWritebackRows] = useState<Record<WritebackFieldKey, WritebackMappingRow>>(defaultWritebackRows);
  const [writebackMappingsLoading, setWritebackMappingsLoading] = useState(false);
  const [writebackMappingsSaving, setWritebackMappingsSaving] = useState(false);
  const [writebackMappingsErr, setWritebackMappingsErr] = useState("");
  const [writebackMappingsSavedFlash, setWritebackMappingsSavedFlash] = useState("");
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [propertiesErr, setPropertiesErr] = useState("");

  useEffect(() => {
    setConnection(props.connection);
    setWriteback(!!props.connection?.writeback_enabled);
  }, [props.connection]);

  useEffect(() => {
    setConnectedAtText(
      connection?.connected_at ? new Date(connection.connected_at).toLocaleString() : "—"
    );
    setLastSyncedAtText(
      connection?.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : "—"
    );
  }, [connection?.connected_at, connection?.last_synced_at]);

  useEffect(() => {
    setMappingsComplete(props.mappingsComplete);
    if (props.mappingsComplete) setLayoutEditEnabled(false);
    else setLayoutEditEnabled(true);
  }, [props.mappingsComplete]);

  useEffect(() => {
    setInitialSyncComplete(props.initialSyncComplete);
  }, [props.initialSyncComplete]);

  useEffect(() => {
    if (!layoutSavedFlash) return;
    const id = setTimeout(() => setLayoutSavedFlash(""), 3000);
    return () => clearTimeout(id);
  }, [layoutSavedFlash]);

  useEffect(() => {
    if (!writebackMappingsSavedFlash) return;
    const id = setTimeout(() => setWritebackMappingsSavedFlash(""), 3000);
    return () => clearTimeout(id);
  }, [writebackMappingsSavedFlash]);

  useEffect(() => {
    if (props.mappingsComplete && !props.initialSyncComplete && props.connection) {
      setPoll(true);
    }
  }, [props.mappingsComplete, props.initialSyncComplete, props.connection]);

  const step1Done = !!connection;
  const step2Done = mappingsComplete;
  const step3Visible = step1Done && step2Done;

  // Load Salesforce Opportunity properties for field mapping dropdowns
  useEffect(() => {
    if (!step1Done) return;
    let cancelled = false;
    (async () => {
      setPropertiesErr("");
      try {
        const res = await fetch("/api/integrations/salesforce/properties");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Failed to load Salesforce fields");
        if (cancelled) return;

        // properties endpoint returns field verification — use it for writeback check
        setMissingFields(j.missingFields || []);

        // Load Opportunity field list from SFDC describe
        const descRes = await fetch("/api/integrations/salesforce/properties");
        const descJ = await descRes.json().catch(() => ({}));
        if (!cancelled && Array.isArray(descJ.requiredFields)) {
          // We don't have a separate describe endpoint yet — seed from saved mappings
        }

        // Build rows from saved mappings
        const next: Record<string, { sfdc_api_name: string | null; confidence: string }> = {};
        const saved = (props.savedMappings || []).filter(
          (x) =>
            x.sf_field !== "company_name" &&
            x.sf_field !== "crm_opp_id" &&
            x.sf_field !== "create_date"
        );
        for (const s of saved) {
          next[s.sf_field] = {
            sfdc_api_name: s.sfdc_api_name,
            confidence: s.confidence || "none",
          };
        }
        // Seed defaults for unmapped required fields
        for (const [sfField, defaultApiName] of Object.entries(SF_DEFAULTS)) {
          if (!next[sfField]) {
            next[sfField] = { sfdc_api_name: defaultApiName, confidence: "high" };
          }
        }
        setRows(next);
      } catch (e: any) {
        if (!cancelled) setPropertiesErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [step1Done, props.savedMappings]);

  // Load writeback mappings
  useEffect(() => {
    if (!step1Done) return;
    let cancelled = false;
    (async () => {
      setWritebackMappingsLoading(true);
      setWritebackMappingsErr("");
      try {
        const res = await fetch("/api/integrations/salesforce/writeback-mappings");
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok || !Array.isArray(j.mappings)) {
          throw new Error(j.error || "Failed to load writeback mappings");
        }
        if (cancelled) return;
        const next = defaultWritebackRows();
        for (const row of j.mappings as Array<{ sf_field: string; sfdc_api_name: string | null }>) {
          const sf = String(row?.sf_field || "").trim() as WritebackFieldKey;
          if (!(sf in next)) continue;
          next[sf] = {
            sf_field: sf,
            sfdc_api_name: row?.sfdc_api_name == null ? null : String(row.sfdc_api_name),
          };
        }
        setWritebackRows(next);
      } catch {
        // Writeback mappings may not exist yet — use defaults silently
      } finally {
        if (!cancelled) setWritebackMappingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step1Done]);

  const tableLocked = mappingsComplete && !layoutEditEnabled;

  const buildMappingsPayload = (): SavedMap[] => {
    const mappings: SavedMap[] = [];
    for (const sf of Object.keys(SF_LABELS)) {
      const r = rows[sf];
      mappings.push({
        sf_field: sf,
        sfdc_api_name: r?.sfdc_api_name || SF_DEFAULTS[sf] || null,
        confidence: r?.confidence || "none",
      });
    }
    return mappings;
  };

  const persistMappings = async (triggerSync: boolean) => {
    const res = await fetch("/api/integrations/salesforce/mappings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: buildMappingsPayload(), triggerSync }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || "Save failed");
    return j as { ok: boolean; syncQueued?: boolean };
  };

  const saveLayout = async () => {
    setBusy(true);
    setErr("");
    try {
      await persistMappings(false);
      setMappingsComplete(true);
      setLayoutEditEnabled(false);
      setLayoutSavedFlash(String(Date.now()));
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAndSyncNow = async () => {
    setBusy(true);
    setErr("");
    try {
      const j = await persistMappings(true);
      setMappingsComplete(true);
      setLayoutEditEnabled(false);
      if (j.syncQueued) {
        setInitialSyncComplete(false);
        setPoll(true);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const pollSync = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/salesforce/sync");
      const j = await res.json();
      if (res.ok) setSyncStatus(j);
      if (j.status === "completed" || j.status === "failed") {
        setPoll(false);
        if (j.status === "completed") setInitialSyncComplete(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!poll) return;
    pollSync();
    const id = setInterval(pollSync, 3000);
    return () => clearInterval(id);
  }, [poll, pollSync]);

  const disconnect = async () => {
    if (!confirm("Disconnect Salesforce for this organization? This will remove stored tokens and sync history.")) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/salesforce/disconnect", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Disconnect failed");
      setConnection(null);
      setMappingsComplete(false);
      setLayoutEditEnabled(true);
      setInitialSyncComplete(false);
      setRows({});
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/salesforce/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Sync failed");
      setPoll(true);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleWriteback = async (enabled: boolean) => {
    if (enabled && missingFields.length > 0) {
      alert(
        `Before enabling writeback, ask your Salesforce administrator to create these custom fields on the Opportunity object:\n\n${missingFields.join("\n")}\n\nThen refresh this page and try again.`
      );
      return;
    }
    if (enabled) {
      if (
        !confirm(
          "This will write SalesForecast.io scores to your Salesforce Opportunity custom fields. Your existing fields are never modified. Continue?"
        )
      )
        return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/salesforce/writeback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        if (j.missingFields?.length) {
          setMissingFields(j.missingFields);
          throw new Error(
            `Missing custom fields on Opportunity: ${j.missingFields.join(", ")}. Ask your Salesforce admin to create them first.`
          );
        }
        throw new Error(j.error || "Update failed");
      }
      setWriteback(!!j.writeback_enabled);
      if (connection) setConnection({ ...connection, writeback_enabled: !!j.writeback_enabled });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveWritebackMappings = async () => {
    setWritebackMappingsSaving(true);
    setWritebackMappingsErr("");
    try {
      const mappings = WRITEBACK_FIELDS.map((field) => {
        const row = writebackRows[field.sf_field] || defaultWritebackRows()[field.sf_field];
        return {
          sf_field: field.sf_field,
          sfdc_api_name: row.sfdc_api_name || field.defaultApiName,
        };
      });
      const res = await fetch("/api/integrations/salesforce/writeback-mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Save failed");
      setWritebackMappingsSavedFlash(String(Date.now()));
    } catch (e: any) {
      setWritebackMappingsErr(e?.message || String(e));
    } finally {
      setWritebackMappingsSaving(false);
    }
  };

  return (
    <main>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
          Salesforce
        </h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Connect Salesforce, map Opportunity fields, and sync deals into SalesForecast.io.
        </p>
        {err ? <p className="mt-2 text-sm text-[#E74C3C]">{err}</p> : null}
        {propertiesErr ? (
          <p className="mt-2 text-sm text-amber-700">Field load warning: {propertiesErr}</p>
        ) : null}
      </div>

      {/* Step 1 — Connect */}
      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
          Step 1 — Connect Salesforce
        </h2>
        {!connection ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              Connect your Salesforce org to sync Opportunities into SalesForecast.io. You&apos;ll map
              your fields in the next step.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/integrations/salesforce/connect"
                className="inline-flex rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
              >
                Connect Salesforce (Production)
              </a>
              <a
                href="/api/integrations/salesforce/connect?sandbox=true"
                className="inline-flex rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-2 text-sm font-medium text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
              >
                Connect Sandbox
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Connected
              </span>
              {connection.sandbox ? (
                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-900">
                  Sandbox
                </span>
              ) : null}
              <span className="text-[color:var(--sf-text-secondary)]">
                {connection.instance_url || connection.sf_org_id || "Salesforce"}
              </span>
            </div>
            <div className="text-[color:var(--sf-text-secondary)]">
              API version:{" "}
              <span className="text-[color:var(--sf-text-primary)]">
                {connection.api_version || "v59.0"}
              </span>
            </div>
            <div className="text-[color:var(--sf-text-secondary)]">Connected {connectedAtText}</div>
            <button
              type="button"
              disabled={busy}
              onClick={disconnect}
              className="rounded-md border border-[#E74C3C] px-3 py-1.5 text-xs font-medium text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        )}
      </section>

      {/* Step 2 — Map fields */}
      {step1Done ? (
        <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
            Step 2 — Map your fields
          </h2>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Map your Salesforce Opportunity API field names to SalesForecast.io fields. Defaults are
            pre-filled with standard Salesforce field names.
          </p>
          {mappingsComplete && !layoutEditEnabled ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-emerald-800">✓ Using saved layout</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setLayoutEditEnabled(true)}
                className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-50"
              >
                Edit
              </button>
            </div>
          ) : null}
          <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                <tr>
                  <th className="px-3 py-2">SalesForecast field</th>
                  <th className="px-3 py-2">Salesforce API field name</th>
                  <th className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(SF_LABELS).map(([sf, label]) => {
                  const r = rows[sf] || {
                    sfdc_api_name: SF_DEFAULTS[sf] || null,
                    confidence: "none",
                  };
                  const badge =
                    r.confidence === "high"
                      ? "bg-emerald-600/15 text-emerald-800"
                      : r.confidence === "medium"
                        ? "bg-amber-400/20 text-amber-900"
                        : r.confidence === "low"
                          ? "bg-orange-400/20 text-orange-900"
                          : "bg-zinc-200 text-zinc-700";
                  return (
                    <tr key={sf} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-3 py-2 text-[color:var(--sf-text-primary)]">
                        <div>{label}</div>
                        {sf === "forecast_stage" ? (
                          <p className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">
                            Maps to ForecastCategoryName by default.
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={busy || tableLocked}
                          className="w-full max-w-xs rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm font-mono disabled:opacity-50"
                          placeholder={SF_DEFAULTS[sf] || SF_PLACEHOLDERS[sf] || "Custom field API name"}
                          value={r.sfdc_api_name || ""}
                          onChange={(e) => {
                            const v = e.target.value.trim() || null;
                            setRows((prev) => ({
                              ...prev,
                              [sf]: {
                                sfdc_api_name: v,
                                confidence: v ? "medium" : "none",
                              },
                            }));
                          }}
                        />
                        {SF_DEFAULTS[sf] ? (
                          <p className="mt-0.5 text-[11px] text-[color:var(--sf-text-secondary)]">
                            Default: <span className="font-mono">{SF_DEFAULTS[sf]}</span>
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badge}`}
                        >
                          {r.confidence}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || tableLocked}
              onClick={saveLayout}
              className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-50"
            >
              Save Layout
            </button>
            {layoutSavedFlash ? (
              <span className="text-sm font-medium text-emerald-800">Layout saved ✓</span>
            ) : null}
            {mappingsComplete && !initialSyncComplete ? (
              <button
                type="button"
                disabled={busy}
                onClick={saveAndSyncNow}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-2 text-sm font-medium text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
              >
                Save &amp; Sync Now
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Step 3 — Sync & settings */}
      {step3Visible ? (
        <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
            Step 3 — Sync &amp; settings
          </h2>
          <div className="mt-3 space-y-2 text-sm text-[color:var(--sf-text-secondary)]">
            {poll ||
            syncStatus?.status === "pending" ||
            syncStatus?.status === "running" ? (
              <div>
                <div className="text-[color:var(--sf-text-primary)]">Sync in progress…</div>
                <div className="mt-1 font-mono text-xs">
                  fetched {syncStatus?.opportunities_fetched ?? 0} · upserted (metadata){" "}
                  {syncStatus?.opportunities_upserted ?? 0} · baseline AI-scored{" "}
                  {syncStatus?.opportunities_scored ?? 0}
                </div>
              </div>
            ) : (
              <div>
                Last status:{" "}
                <span className="font-medium text-[color:var(--sf-text-primary)]">
                  {syncStatus?.status || (initialSyncComplete ? "completed" : "—")}
                </span>
                {syncStatus?.error_text ? (
                  <span className="ml-2 text-[#E74C3C]">{syncStatus.error_text}</span>
                ) : null}
              </div>
            )}
            <div>Last sync: {lastSyncedAtText}</div>
            <button
              type="button"
              disabled={busy}
              onClick={syncNow}
              className="mt-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-1.5 text-sm hover:bg-[color:var(--sf-surface)] disabled:opacity-50"
            >
              Sync Now
            </button>
          </div>

          {/* Writeback */}
          <div className="mt-8 border-t border-[color:var(--sf-border)] pt-6">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
              Score writeback to Salesforce
            </h3>
            <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
              Write SalesForecast.io scores to your Salesforce Opportunity custom fields. Before
              enabling, ask your Salesforce administrator to create the four custom fields below on the
              Opportunity object. Your existing fields are never modified.
            </p>

            {/* Required custom fields table */}
            <div className="mt-4 overflow-auto rounded-lg border border-[color:var(--sf-border)]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                  <tr>
                    <th className="px-3 py-2">Field API Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {WRITEBACK_FIELDS.map((field) => {
                    const missing = missingFields.includes(field.defaultApiName);
                    const displayName = field.defaultApiName.replace(/__c$/, "");
                    return (
                      <tr key={field.sf_field} className="border-t border-[color:var(--sf-border)]">
                        <td className="px-3 py-3 align-top text-[color:var(--sf-text-primary)]">
                          <div className="font-medium">{field.label}</div>
                          <div className="mt-1 font-mono text-xs text-[color:var(--sf-text-secondary)]">
                            API Name: <span className="text-[color:var(--sf-text-primary)]">{displayName}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[color:var(--sf-text-secondary)]">
                            Salesforce adds <span className="font-mono">__c</span> automatically — do not type it
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top text-[color:var(--sf-text-secondary)]">
                          <div>{field.fieldType}</div>
                          <div className="mt-1 text-[11px] text-amber-800">Set to Read-Only on page layout</div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          {missing ? (
                            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-900">
                              Missing
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              ✓ Found
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                checked={writeback}
                onChange={(e) => toggleWriteback(e.target.checked)}
                disabled={busy}
              />
              Enabled
            </label>

            {writeback ? (
              <div className="mt-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">
                    Writeback field mapping
                  </h4>
                  <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                    Confirm or update the Salesforce custom field API names for each SalesForecast.io
                    score field.
                  </p>
                  {writebackMappingsErr ? (
                    <p className="mt-2 text-sm text-[#E74C3C]">{writebackMappingsErr}</p>
                  ) : null}
                </div>

                {writebackMappingsLoading ? (
                  <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-secondary)]">
                    Loading writeback mappings…
                  </div>
                ) : (
                  <>
                    <div className="overflow-auto rounded-lg border border-[color:var(--sf-border)]">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                          <tr>
                            <th className="px-3 py-2">SalesForecast field</th>
                            <th className="px-3 py-2">Salesforce custom field API name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {WRITEBACK_FIELDS.map((field) => {
                            const row =
                              writebackRows[field.sf_field] ||
                              defaultWritebackRows()[field.sf_field];
                            return (
                              <tr
                                key={field.sf_field}
                                className="border-t border-[color:var(--sf-border)]"
                              >
                                <td className="px-3 py-3 align-top text-[color:var(--sf-text-primary)]">
                                  <div className="font-medium">{field.label}</div>
                                  <div className="mt-1 text-[11px] leading-relaxed text-[color:var(--sf-text-secondary)]">
                                    {field.description}
                                  </div>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <input
                                    type="text"
                                    disabled={writebackMappingsSaving}
                                    className="w-full max-w-xs rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 font-mono text-sm disabled:opacity-50"
                                    placeholder={field.defaultApiName}
                                    value={row.sfdc_api_name || ""}
                                    onChange={(e) =>
                                      setWritebackRows((prev) => ({
                                        ...prev,
                                        [field.sf_field]: {
                                          ...row,
                                          sfdc_api_name: e.target.value.trim() || null,
                                        },
                                      }))
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={writebackMappingsSaving}
                        onClick={saveWritebackMappings}
                        className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-50"
                      >
                        Save Writeback Mapping
                      </button>
                      {writebackMappingsSavedFlash ? (
                        <span className="text-sm font-medium text-emerald-800">
                          Writeback mapping saved ✓
                        </span>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
