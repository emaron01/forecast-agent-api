"use client";

import type { HubSpotDealState } from "./types";

const CATEGORIES = [
  {
    key: "pain",
    title: "Pain – Why It Matters",
    subtitle: "The core problem and urgency",
  },
  {
    key: "metrics",
    title: "Metrics – Business Impact",
    subtitle: "Quantifies the measurable upside",
  },
  {
    key: "champion",
    title: "Champion – Internal Advocate",
    subtitle: "Who is pushing internally and why",
  },
  {
    key: "criteria",
    title: "Decision Criteria – How They Choose",
    subtitle: "What matters most in their evaluation",
  },
  {
    key: "competition",
    title: "Competition – Alternatives in Play",
    subtitle: "Who else they are considering",
  },
  {
    key: "timing",
    title: "Timeline – Why Now",
    subtitle: "Trigger event, deadline, or forcing function",
  },
  {
    key: "budget",
    title: "Budget – Available Funding",
    subtitle: "Do they have access to funds to purchase",
  },
  {
    key: "eb",
    title: "Economic Buyer – Decision Power",
    subtitle: "Who truly controls the spend",
  },
  {
    key: "process",
    title: "Decision Process – How They Buy",
    subtitle: "Steps, approvals, sequencing",
  },
  {
    key: "paper",
    title: "Paper Process – Procurement Path",
    subtitle: "Legal, security, and vendor steps required",
  },
] as const;

function scoreBadgeColor(score: number | null): string {
  if (score == null) return "text-gray-500";
  if (score >= 3) return "text-green-400";
  if (score >= 2) return "text-yellow-400";
  if (score >= 1) return "text-orange-400";
  return "text-red-400";
}

function healthColor(pct: number | null): string {
  if (pct == null) return "text-gray-400";
  if (pct >= 70) return "text-green-400";
  if (pct >= 40) return "text-yellow-400";
  return "text-red-400";
}

type Props = {
  dealState: HubSpotDealState;
  onStartVoice: () => void;
  onStartText: () => void;
};

export default function DealOverview({ dealState: d, onStartVoice, onStartText }: Props) {
  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">
      <div className="px-6 py-4 border-b border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">
              {d.account_name ?? "—"}
              {d.opportunity_name ? ` · ${d.opportunity_name}` : ""}
            </h1>
            <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {d.rep_name && <span>Rep: {d.rep_name}</span>}
              {d.forecast_stage && <span>Forecast: {d.forecast_stage}</span>}
              {d.close_date && <span>Close: {d.close_date.slice(0, 10)}</span>}
              {d.amount != null && <span>${Number(d.amount).toLocaleString()}</span>}
              {d.partner_name && <span>Partner: {d.partner_name}</span>}
            </div>
            {(d.champion_name || d.eb_name) && (
              <div className="text-sm text-gray-400 mt-1 flex gap-x-4">
                {d.champion_name && (
                  <span>
                    Internal Sponsor: {d.champion_name}
                    {d.champion_title ? ` · ${d.champion_title}` : ""}
                  </span>
                )}
                {d.eb_name && (
                  <span>
                    Economic Buyer: {d.eb_name}
                    {d.eb_title ? ` · ${d.eb_title}` : ""}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {d.health_pct != null && (
              <span className={`text-2xl font-bold ${healthColor(d.health_pct)}`}>{d.health_pct}%</span>
            )}
            {d.ai_verdict && <span className="text-xs text-gray-400">AI: {d.ai_verdict}</span>}
            {d.confidence_band && <span className="text-xs text-gray-400">Confidence: {d.confidence_band}</span>}
          </div>
        </div>
      </div>

      {(d.risk_summary || d.next_steps) && (
        <div className="px-6 py-4 grid grid-cols-2 gap-4 border-b border-white/10">
          {d.risk_summary && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Risk Summary</p>
              <p className="text-sm text-gray-200">{d.risk_summary}</p>
            </div>
          )}
          {d.next_steps && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Next Steps</p>
              <p className="text-sm text-gray-200">{d.next_steps}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 px-6 py-4 grid grid-cols-4 gap-3 overflow-y-auto">
        {CATEGORIES.map((cat) => {
          const score = d[`${cat.key}_score` as keyof HubSpotDealState] as number | null;
          const summary = d[`${cat.key}_summary` as keyof HubSpotDealState] as string | null;
          const tip = d[`${cat.key}_tip` as keyof HubSpotDealState] as string | null;
          return (
            <div
              key={cat.key}
              className="bg-[#1a1f2e] rounded-lg p-3 border border-white/10 flex flex-col gap-2"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-white leading-tight">{cat.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{cat.subtitle}</p>
                </div>
                <span className={`text-sm font-bold shrink-0 ml-2 ${scoreBadgeColor(score)}`}>{score ?? 0}/3</span>
              </div>
              {tip && <p className="text-xs text-yellow-400">Tip: {tip}</p>}
              {summary && <p className="text-xs text-gray-400">Evidence: {summary}</p>}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 bg-[#0f1117] border-t border-white/10 px-6 py-4 flex items-center gap-4">
        <button
          onClick={onStartVoice}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold transition-colors"
        >
          ▶ Start Voice Review
        </button>
        <button
          onClick={onStartText}
          className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition-colors"
        >
          ✎ Text Update
        </button>
        <div className="ml-auto flex gap-4 text-sm text-gray-400">
          {d.health_pct != null && <span className={healthColor(d.health_pct)}>Health {d.health_pct}%</span>}
          {d.ai_verdict && <span>AI: {d.ai_verdict}</span>}
          {d.confidence_band && <span>Confidence: {d.confidence_band}</span>}
        </div>
      </div>
    </div>
  );
}

