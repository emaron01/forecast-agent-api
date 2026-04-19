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

export function HubspotIntegrationClient(props: {
  orgId: number;
  connection: Conn;
  mappingsComplete: boolean;
  initialSyncComplete: boolean;
  savedMappings: SavedMap[];
}) {
  const [connection, setConnection] = useState<Conn>(props.connection);
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
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [writeback, setWriteback] = useState(!!props.connection?.writeback_enabled);
  const [poll, setPoll] = useState(false);
  /** Tier sent as `?tier=` on the HubSpot OAuth connect URL (default Professional / Enterprise). */
  const [oauthConnectTier, setOauthConnectTier] = useState<"starter" | "professional">("professional");

  useEffect(() => {
    setConnection(props.connection);
    setWriteback(!!props.connection?.writeback_enabled);
  }, [props.connection]);

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

  const textProps = useMemo(
    () =>
      (properties || []).filter((p) => {
        const t = (p.type || "").toLowerCase();
        const ft = (p.fieldType || "").toLowerCase();
        return t === "string" || ft.includes("text");
      }),
    [properties]
  );

  const saveMappings = async () => {
    setBusy(true);
    setErr("");
    try {
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
      const res = await fetch("/api/integrations/hubspot/mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Save failed");
      setMappingsComplete(true);
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
              Connected {connection.connected_at ? new Date(connection.connected_at).toLocaleString() : "—"}
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
                          className="w-full max-w-xs rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm"
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
              <input type="checkbox" className="mt-0.5" checked={notesEngagements} onChange={(e) => setNotesEngagements(e.target.checked)} />
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
                className="mt-1 w-full max-w-md rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-sm"
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
            <button
              type="button"
              disabled={busy}
              onClick={saveMappings}
              className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-50"
            >
              Save &amp; Start Sync
            </button>
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
            <div>Last sync: {connection?.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : "—"}</div>
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
              Write SalesForecast.io scores to HubSpot deal records. Creates a &quot;SalesForecast.io&quot; property group on your deals with eight fields:
              Overall Health, AI Verdict, Score Source, Top Risk Categories, Last Reviewed, Review Count, Risk Summary, and Next Steps. You can disable this
              at any time. Your existing HubSpot fields are never modified.
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
              <input type="checkbox" checked={writeback} onChange={(e) => toggleWriteback(e.target.checked)} disabled={busy} />
              Enabled
            </label>
          </div>
        </section>
      ) : null}
    </main>
  );
}
