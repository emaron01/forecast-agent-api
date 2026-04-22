"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Conn = {
  hub_domain: string | null;
  hub_tier: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  writeback_enabled: boolean;
} | null;

function hubTierDisplayLabel(tier: string | null | undefined): string {
  if (tier === "starter") return "Starter";
  return "Professional / Enterprise";
}

type SavedMap = { sf_field: string; hubspot_property: string | null; confidence: string };

type WritebackFieldKey = "health_initial" | "health_current" | "risk_summary" | "next_steps";

type WritebackMappingRow = {
  sf_field: WritebackFieldKey;
  mode: "sf_property" | "custom";
  hubspot_property: string | null;
};

const SF_LABELS: Record<string, string> = {
  deal_name: "Opportunity Name",
  amount: "Revenue (Amount)",
  close_date: "Close Date",
  stage: "Sales Stage",
  owner: "Account Owner",
  forecast_stage: "Forecast Stage (Pro/Enterprise)",
  product: "Product (optional)",
  partner_name: "Partner Name (optional)",
  deal_reg: "Deal Registration (optional)",
  deal_reg_date: "Deal Registration Date (optional)",
  deal_reg_id: "Deal Registration ID / Number (optional)",
};

const WRITEBACK_FIELDS: Array<{
  sf_field: WritebackFieldKey;
  label: string;
  description: string;
  sfPropertyName: string;
  compatibleType: "number" | "string";
}> = [
  {
    sf_field: "health_initial",
    label: "Initial Health Score",
    description: "Written once when Matthew first reviews this deal. Never overwritten.",
    sfPropertyName: "sf_health_initial",
    compatibleType: "number",
  },
  {
    sf_field: "health_current",
    label: "Current Health Score",
    description: "Updated after every Matthew review.",
    sfPropertyName: "sf_health_current",
    compatibleType: "number",
  },
  {
    sf_field: "risk_summary",
    label: "Risk Summary",
    description: "Matthew's narrative risk assessment.",
    sfPropertyName: "sf_risk_summary",
    compatibleType: "string",
  },
  {
    sf_field: "next_steps",
    label: "Next Steps",
    description: "Matthew's recommended next steps.",
    sfPropertyName: "sf_next_steps",
    compatibleType: "string",
  },
];

function defaultWritebackRows(): Record<WritebackFieldKey, WritebackMappingRow> {
  return {
    health_initial: { sf_field: "health_initial", mode: "sf_property", hubspot_property: null },
    health_current: { sf_field: "health_current", mode: "sf_property", hubspot_property: null },
    risk_summary: { sf_field: "risk_summary", mode: "sf_property", hubspot_property: null },
    next_steps: { sf_field: "next_steps", mode: "sf_property", hubspot_property: null },
  };
}

export function HubspotIntegrationClient(props: {
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
  const [properties, setProperties] = useState<Array<{ name: string; label: string; type: string; fieldType?: string }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{ sf_field: string; hubspot_property: string | null; confidence: string }>>([]);
  const [rows, setRows] = useState<Record<string, { hubspot_property: string | null; confidence: string }>>({});
  const [notesEngagements, setNotesEngagements] = useState(true);
  const [notesCustomProp, setNotesCustomProp] = useState("");
  const [notesPreviewLoading, setNotesPreviewLoading] = useState(false);
  const [notesPreview, setNotesPreview] = useState<{
    checked: boolean;
    deals_checked: number;
    deals_with_notes: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [layoutEditEnabled, setLayoutEditEnabled] = useState(!props.mappingsComplete);
  const [layoutSavedFlash, setLayoutSavedFlash] = useState("");
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [writeback, setWriteback] = useState(!!props.connection?.writeback_enabled);
  const [poll, setPoll] = useState(false);
  /** Tier sent as `?tier=` on the HubSpot OAuth connect URL (default Professional / Enterprise). */
  const [oauthConnectTier, setOauthConnectTier] = useState<"starter" | "professional">("professional");
  const [writebackRows, setWritebackRows] = useState<Record<WritebackFieldKey, WritebackMappingRow>>(defaultWritebackRows);
  const [writebackMappingsLoading, setWritebackMappingsLoading] = useState(false);
  const [writebackMappingsSaving, setWritebackMappingsSaving] = useState(false);
  const [writebackMappingsErr, setWritebackMappingsErr] = useState("");
  const [writebackMappingsSavedFlash, setWritebackMappingsSavedFlash] = useState("");

  useEffect(() => {
    setConnection(props.connection);
    setWriteback(!!props.connection?.writeback_enabled);
  }, [props.connection]);

  useEffect(() => {
    setConnectedAtText(connection?.connected_at ? new Date(connection.connected_at).toLocaleString() : "—");
    setLastSyncedAtText(connection?.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : "—");
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

  useEffect(() => {
    if (!step1Done) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/hubspot/properties");
        const j = await res.json();
        if (!res.ok || !j.properties) throw new Error(j.error || "Failed to load properties");
        if (cancelled) return;
        setProperties(j.properties);
        setSuggestions(j.suggestions || []);
        const next: Record<string, { hubspot_property: string | null; confidence: string }> = {};
        const saved = (props.savedMappings || []).filter(
          (x) =>
            x.sf_field !== "notes_source" &&
            x.sf_field !== "company_name" &&
            x.sf_field !== "crm_opp_id" &&
            x.sf_field !== "create_date"
        );
        for (const s of saved) {
          next[s.sf_field] = { hubspot_property: s.hubspot_property, confidence: s.confidence || "none" };
        }
        for (const sug of j.suggestions || []) {
          if (
            sug.sf_field === "notes_source" ||
            sug.sf_field === "company_name" ||
            sug.sf_field === "crm_opp_id" ||
            sug.sf_field === "create_date"
          ) {
            continue;
          }
          if (!next[sug.sf_field]) {
            next[sug.sf_field] = { hubspot_property: sug.hubspot_property, confidence: sug.confidence };
          }
        }
        setRows(next);
        const ns = (props.savedMappings || []).find((x) => x.sf_field === "notes_source");
        if (ns?.hubspot_property) {
          try {
            const parsed = JSON.parse(ns.hubspot_property);
            setNotesEngagements(parsed?.engagements !== false);
            setNotesCustomProp(typeof parsed?.custom_property === "string" ? parsed.custom_property : "");
          } catch {
            setNotesEngagements(true);
          }
        }

        setNotesPreviewLoading(true);
        setNotesPreview(null);
        void fetch("/api/integrations/hubspot/notes-preview")
          .then(async (res) => {
            const j = await res.json().catch(() => ({}));
            if (cancelled) return;
            setNotesPreviewLoading(false);
            if (!res.ok || j.checked !== true || typeof j.deals_checked !== "number") {
              setNotesPreview({ checked: false, deals_checked: 0, deals_with_notes: 0 });
              return;
            }
            setNotesPreview({
              checked: true,
              deals_checked: j.deals_checked,
              deals_with_notes: Number(j.deals_with_notes) || 0,
            });
          })
          .catch(() => {
            if (!cancelled) {
              setNotesPreviewLoading(false);
              setNotesPreview({ checked: false, deals_checked: 0, deals_with_notes: 0 });
            }
          });
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step1Done, props.savedMappings]);

  useEffect(() => {
    if (!step1Done) return;
    let cancelled = false;
    (async () => {
      setWritebackMappingsLoading(true);
      setWritebackMappingsErr("");
      try {
        const res = await fetch("/api/integrations/hubspot/writeback-mappings");
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok || !Array.isArray(j.mappings)) {
          throw new Error(j.error || "Failed to load writeback mappings");
        }
        if (cancelled) return;
        const next = defaultWritebackRows();
        for (const row of j.mappings as Array<{ sf_field: string; mode: string; hubspot_property: string | null }>) {
          const sf = String(row?.sf_field || "").trim() as WritebackFieldKey;
          if (!(sf in next)) continue;
          next[sf] = {
            sf_field: sf,
            mode: row?.mode === "custom" ? "custom" : "sf_property",
            hubspot_property: row?.hubspot_property == null ? null : String(row.hubspot_property),
          };
        }
        setWritebackRows(next);
      } catch (e: any) {
        if (!cancelled) setWritebackMappingsErr(e?.message || String(e));
      } finally {
        if (!cancelled) setWritebackMappingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step1Done]);

  const textProps = useMemo(
    () =>
      (properties || []).filter((p) => {
        const t = (p.type || "").toLowerCase();
        const ft = (p.fieldType || "").toLowerCase();
        return t === "string" || ft.includes("text");
      }),
    [properties]
  );

  const numberProps = useMemo(
    () =>
      (properties || []).filter((p) => {
        const t = (p.type || "").toLowerCase();
        return t === "number";
      }),
    [properties]
  );

  const writebackStringProps = useMemo(
    () =>
      (properties || []).filter((p) => {
        const t = (p.type || "").toLowerCase();
        return t === "string";
      }),
    [properties]
  );

  const writebackPropertyOptions = useMemo(() => {
    return {
      number: numberProps,
      string: writebackStringProps,
    };
  }, [numberProps, writebackStringProps]);

  const buildMappingsPayload = (): SavedMap[] => {
    const mappings: SavedMap[] = [];
    for (const sf of Object.keys(SF_LABELS)) {
      const r = rows[sf];
      mappings.push({
        sf_field: sf,
        hubspot_property: r?.hubspot_property || null,
        confidence: r?.confidence || "none",
      });
    }
    mappings.push({
      sf_field: "notes_source",
      hubspot_property: JSON.stringify({
        engagements: notesEngagements,
        ...(notesCustomProp.trim() ? { custom_property: notesCustomProp.trim() } : {}),
      }),
      confidence: "high",
    });
    return mappings;
  };

  const persistMappings = async (triggerSync: boolean) => {
    const res = await fetch("/api/integrations/hubspot/mappings", {
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

  const tableLocked = mappingsComplete && !layoutEditEnabled;

  const pollSync = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/hubspot/sync");
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

  const disconnect = async (message?: string) => {
    if (!confirm(message || "Disconnect HubSpot for this organization?")) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/hubspot/disconnect", { method: "POST" });
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

  const updatePlanTier = () =>
    disconnect(
      "To change your HubSpot plan tier, this integration will disconnect. Choose Starter or Professional/Enterprise below, then connect again to re-authorize the correct HubSpot scopes."
    );

  const syncNow = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/hubspot/sync", { method: "POST" });
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
    if (enabled) {
      if (!confirm('This will create custom properties in your HubSpot account. This does not modify any of your existing fields. Continue?')) return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/integrations/hubspot/writeback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Update failed");
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
          mode: row.mode,
          hubspot_property: row.mode === "custom" ? row.hubspot_property || null : null,
        };
      });
      const res = await fetch("/api/integrations/hubspot/writeback-mappings", {
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
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">HubSpot</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Connect HubSpot, map fields, and sync deals into SalesForecast.io.</p>
        {err ? <p className="mt-2 text-sm text-[#E74C3C]">{err}</p> : null}
      </div>

      <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Step 1 — Connect HubSpot</h2>
        {!connection ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[color:var(--sf-text-secondary)]">
              Connect your HubSpot account to sync deals into SalesForecast.io. You&apos;ll map your fields in the next step.
            </p>
            <div className="space-y-2">
              <div className="text-xs font-medium text-[color:var(--sf-text-secondary)]">HubSpot plan</div>
              <div className="flex flex-col gap-2 text-sm text-[color:var(--sf-text-primary)]">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="hubspot-oauth-tier"
                    className="accent-[color:var(--sf-button-primary-bg)]"
                    checked={oauthConnectTier === "starter"}
                    onChange={() => setOauthConnectTier("starter")}
                  />
                  Starter
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="hubspot-oauth-tier"
                    className="accent-[color:var(--sf-button-primary-bg)]"
                    checked={oauthConnectTier === "professional"}
                    onChange={() => setOauthConnectTier("professional")}
                  />
                  Professional / Enterprise
                </label>
              </div>
              <p className="text-xs text-[color:var(--sf-text-secondary)]">
                Starter includes core deal sync. Professional/Enterprise adds HubSpot native forecast stage data for additional deal context.
              </p>
            </div>
            <a
              href={`/api/integrations/hubspot/connect?tier=${oauthConnectTier}`}
              className="inline-flex rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)]"
            >
              Connect HubSpot
            </a>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700">Connected</span>
              <span className="text-[color:var(--sf-text-secondary)]">{connection.hub_domain || "HubSpot"}</span>
            </div>
            <div className="text-[color:var(--sf-text-secondary)]">
              HubSpot plan: <span className="text-[color:var(--sf-text-primary)]">{hubTierDisplayLabel(connection.hub_tier)}</span>
            </div>
            <div className="text-[color:var(--sf-text-secondary)]">
              Connected {connectedAtText}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => disconnect()}
                className="rounded-md border border-[#E74C3C] px-3 py-1.5 text-xs font-medium text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-50"
              >
                Disconnect
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={updatePlanTier}
                className="text-xs font-medium text-[color:var(--sf-text-primary)] underline decoration-[color:var(--sf-border)] underline-offset-2 hover:decoration-[color:var(--sf-text-primary)] disabled:opacity-50"
              >
                Update plan
              </button>
            </div>
          </div>
        )}
      </section>

      {step1Done ? (
        <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Step 2 — Map your fields</h2>
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
                  <th className="px-3 py-2">HubSpot property</th>
                  <th className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(SF_LABELS).map(([sf, label]) => {
                  const r = rows[sf] || { hubspot_property: null, confidence: "none" };
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
                            Requires HubSpot Sales Hub Professional or Enterprise.
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          disabled={busy || tableLocked}
                          className="w-full max-w-xs rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm disabled:opacity-50"
                          value={r.hubspot_property || ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            const sug = suggestions.find((s) => s.sf_field === sf);
                            setRows((prev) => ({
                              ...prev,
                              [sf]: { hubspot_property: v, confidence: sug?.confidence || (v ? "medium" : "none") },
                            }));
                          }}
                        >
                          <option value="">(none)</option>
                          {properties.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.label} ({p.name})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badge}`}>{r.confidence}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Notes source</h3>
            <label className="flex items-start gap-2 text-sm text-[color:var(--sf-text-primary)]">
              <input
                type="checkbox"
                className="mt-0.5 disabled:opacity-50"
                disabled={busy || tableLocked}
                checked={notesEngagements}
                onChange={(e) => setNotesEngagements(e.target.checked)}
              />
              <span>
                <span className="block">Pull from HubSpot Notes/Engagements</span>
                {notesPreviewLoading ? (
                  <span className="mt-1 block text-[11px] text-[color:var(--sf-text-secondary)]">Checking for notes...</span>
                ) : notesPreview?.checked === true ? (
                  notesPreview.deals_with_notes > 0 ? (
                    <span className="mt-1 block text-[11px] text-emerald-800">
                      ✓ Found notes on {notesPreview.deals_with_notes} of {notesPreview.deals_checked} deals sampled
                    </span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-amber-900">
                      ⚠ No notes found in sample — notes added in HubSpot will sync automatically
                    </span>
                  )
                ) : notesPreview !== null ? (
                  <span className="mt-1 block text-[11px] text-[color:var(--sf-text-secondary)]">— Could not check note availability</span>
                ) : null}
              </span>
            </label>
            <div>
              <label className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Also pull from custom text property (optional)</label>
              <select
                disabled={busy || tableLocked}
                className="mt-1 w-full max-w-md rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm disabled:opacity-50"
                value={notesCustomProp}
                onChange={(e) => setNotesCustomProp(e.target.value)}
              >
                <option value="">(none)</option>
                {textProps.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label} ({p.name})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-[color:var(--sf-text-secondary)]">
              Notes are the primary input for AI scoring. Without notes, deals will sync and appear in your pipeline but will not receive an initial AI score.
              We recommend mapping at least one notes source.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy || tableLocked}
                onClick={saveLayout}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-50"
              >
                Save Layout
              </button>
              {layoutSavedFlash ? <span className="text-sm font-medium text-emerald-800">Layout saved ✓</span> : null}
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
          </div>
        </section>
      ) : null}

      {step3Visible ? (
        <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Step 3 — Sync &amp; settings</h2>
          <div className="mt-3 space-y-2 text-sm text-[color:var(--sf-text-secondary)]">
            {poll || syncStatus?.status === "pending" || syncStatus?.status === "running" ? (
              <div>
                <div className="text-[color:var(--sf-text-primary)]">Sync in progress…</div>
                <div className="mt-1 font-mono text-xs">
                  fetched {syncStatus?.deals_fetched ?? 0} · upserted (metadata) {syncStatus?.deals_upserted ?? 0} · baseline AI-scored{" "}
                  {syncStatus?.deals_scored ?? 0}
                </div>
              </div>
            ) : (
              <div>
                Last status:{" "}
                <span className="font-medium text-[color:var(--sf-text-primary)]">{syncStatus?.status || (initialSyncComplete ? "completed" : "—")}</span>
                {syncStatus?.error_text ? <span className="ml-2 text-[#E74C3C]">{syncStatus.error_text}</span> : null}
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

          <div className="mt-8 border-t border-[color:var(--sf-border)] pt-6">
            <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Score writeback to HubSpot</h3>
            <p className="mt-2 text-sm text-[color:var(--sf-text-secondary)]">
              Write SalesForecast.io scores to HubSpot deal records. Creates a &quot;SalesForecast.io&quot; property group on your deals with four fields:
              Initial Health Score, Current Health Score, Risk Summary, and Next Steps. You can disable this at any time. Your existing HubSpot fields are
              never modified.
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
              <input type="checkbox" checked={writeback} onChange={(e) => toggleWriteback(e.target.checked)} disabled={busy} />
              Enabled
            </label>
            {writeback ? (
              <div className="mt-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Writeback field mapping</h4>
                  <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
                    Choose whether each SalesForecast field writes to the managed SalesForecast.io property or an existing compatible HubSpot deal property.
                  </p>
                  {writebackMappingsErr ? <p className="mt-2 text-sm text-[#E74C3C]">{writebackMappingsErr}</p> : null}
                </div>

                {writebackMappingsLoading ? (
                  <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-secondary)]">
                    Loading writeback mappings...
                  </div>
                ) : (
                  <>
                    <div className="overflow-auto rounded-lg border border-[color:var(--sf-border)]">
                      <table className="w-full min-w-[980px] text-left text-sm">
                        <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
                          <tr>
                            <th className="px-3 py-2">SalesForecast field</th>
                            <th className="px-3 py-2">Write to</th>
                            <th className="px-3 py-2">HubSpot destination</th>
                          </tr>
                        </thead>
                        <tbody>
                          {WRITEBACK_FIELDS.map((field) => {
                            const row = writebackRows[field.sf_field] || defaultWritebackRows()[field.sf_field];
                            const options = field.compatibleType === "number" ? writebackPropertyOptions.number : writebackPropertyOptions.string;
                            const listId = `hubspot-writeback-${field.sf_field}`;
                            return (
                              <tr key={field.sf_field} className="border-t border-[color:var(--sf-border)]">
                                <td className="px-3 py-3 align-top text-[color:var(--sf-text-primary)]">
                                  <div className="font-medium">{field.label}</div>
                                  <div className="mt-1 text-[11px] leading-relaxed text-[color:var(--sf-text-secondary)]">{field.description}</div>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <div className="inline-flex rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-1">
                                    <button
                                      type="button"
                                      disabled={writebackMappingsSaving}
                                      onClick={() =>
                                        setWritebackRows((prev) => ({
                                          ...prev,
                                          [field.sf_field]: {
                                            ...row,
                                            mode: "sf_property",
                                            hubspot_property: null,
                                          },
                                        }))
                                      }
                                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                                        row.mode === "sf_property"
                                          ? "bg-[color:var(--sf-button-primary-bg)] text-[color:var(--sf-button-primary-text)]"
                                          : "text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
                                      } disabled:opacity-50`}
                                    >
                                      SalesForecast Property
                                    </button>
                                    <button
                                      type="button"
                                      disabled={writebackMappingsSaving}
                                      onClick={() =>
                                        setWritebackRows((prev) => ({
                                          ...prev,
                                          [field.sf_field]: {
                                            ...row,
                                            mode: "custom",
                                          },
                                        }))
                                      }
                                      className={`rounded px-3 py-1.5 text-xs font-medium ${
                                        row.mode === "custom"
                                          ? "bg-[color:var(--sf-button-primary-bg)] text-[color:var(--sf-button-primary-text)]"
                                          : "text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface)]"
                                      } disabled:opacity-50`}
                                    >
                                      Map to Existing
                                    </button>
                                  </div>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  {row.mode === "sf_property" ? (
                                    <span className="inline-flex rounded-full bg-[color:var(--sf-surface-alt)] px-2.5 py-1 text-xs font-medium text-[color:var(--sf-text-primary)]">
                                      {field.sfPropertyName}
                                    </span>
                                  ) : (
                                    <div className="max-w-md">
                                      <input
                                        list={listId}
                                        disabled={writebackMappingsSaving}
                                        className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm disabled:opacity-50"
                                        placeholder="Search HubSpot properties..."
                                        value={row.hubspot_property || ""}
                                        onChange={(e) =>
                                          setWritebackRows((prev) => ({
                                            ...prev,
                                            [field.sf_field]: {
                                              ...row,
                                              hubspot_property: e.target.value.trim() || null,
                                            },
                                          }))
                                        }
                                      />
                                      <datalist id={listId}>
                                        {options.map((p) => (
                                          <option key={p.name} value={p.name}>
                                            {p.label} ({p.name})
                                          </option>
                                        ))}
                                      </datalist>
                                      <p className="mt-1 text-[11px] text-[color:var(--sf-text-secondary)]">
                                        Compatible HubSpot {field.compatibleType} properties only.
                                      </p>
                                    </div>
                                  )}
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
                      {writebackMappingsSavedFlash ? <span className="text-sm font-medium text-emerald-800">Writeback mapping saved ✓</span> : null}
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
