"use client";

import Image from "next/image";
import { KpiCardsRow } from "../dashboard/executive/KpiCardsRow";
import { ExecutiveQuarterKpisModule, ExecutiveRemainingQuarterlyForecastBlock } from "../dashboard/executive/ExecutiveQuarterKpisModule";
import { ExecutiveDealsDrivingGapModule, type ExecutiveGapDeal } from "../dashboard/executive/ExecutiveDealsDrivingGapModule";
import { RiskRadarPlot, type RadarDeal } from "../dashboard/executive/RiskRadarPlot";
import { palette } from "../../lib/palette";

import { testExecutiveDashboardMock as mock } from "./mockData";

function fmtMoney0(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v)}%`;
}

function fmtSignedMoney0(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return fmtMoney0(0);
  const sign = v > 0 ? "+" : "−";
  return `${sign}${fmtMoney0(Math.abs(v))}`;
}

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
      <div>
        <div className="text-sectionTitle text-[color:var(--sf-text-primary)]">{props.title}</div>
        {props.subtitle ? <div className="mt-1 text-meta">{props.subtitle}</div> : null}
      </div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

function PurpleAddOn(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-purple-500/60 bg-purple-500/5 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-purple-700">NEW (Sandbox add) · {props.title}</div>
          {props.subtitle ? <div className="mt-1 text-xs text-purple-700/80">{props.subtitle}</div> : null}
        </div>
      </div>
      <div className="mt-3 text-sm text-[color:var(--sf-text-primary)]">{props.children}</div>
    </section>
  );
}

function SimpleTable(props: { columns: string[]; rows: Array<Array<string | number | null | undefined>> }) {
  return (
    <div className="overflow-auto rounded-lg border border-[color:var(--sf-border)]">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-[color:var(--sf-surface-alt)] text-xs text-[color:var(--sf-text-secondary)]">
          <tr>
            {props.columns.map((c) => (
              <th key={c} className="px-4 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, idx) => (
            <tr key={idx} className="border-t border-[color:var(--sf-border)]">
              {r.map((cell, j) => (
                <td key={j} className="px-4 py-3">
                  {cell == null ? "—" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function productMixTone(pct: number) {
  if (pct >= 80) return "text-[#2ECC71]";
  if (pct >= 50) return "text-[#F1C40F]";
  return "text-[#E74C3C]";
}

function toExecutiveGapDeals(): ExecutiveGapDeal[] {
  return mock.dealsDrivingGap.map((d) => ({
    id: d.id,
    rep: { rep_public_id: null, rep_name: d.rep_name },
    deal_name: { account_name: d.account_name, opportunity_name: d.opportunity_name },
    crm_stage: { forecast_stage: d.bucket_label, bucket: d.bucket_label === "Commit" ? "commit" : d.bucket_label === "Best Case" ? "best_case" : "pipeline", label: d.bucket_label },
    amount: d.amount,
    health: {
      health_pct: d.health_pct,
      suppression: !!d.suppression,
      health_modifier: d.health_modifier,
    },
    weighted: { gap: d.gap, crm_weighted: undefined, ai_weighted: undefined },
    meddpicc_tb: d.meddpicc_tb.map((c) => ({
      key: c.key,
      score: c.score,
      score_label: c.score_label,
      tip: c.tip,
      evidence: c.evidence,
    })),
    signals: { risk_summary: d.risk_summary, next_steps: d.next_steps },
    risk_flags: d.risk_flags.map((rf) => ({ key: rf.key as any, label: rf.label, tip: rf.tip })),
  }));
}

export function TestExecutiveDashboard() {
  const period = mock.period;
  const gap = mock.aiForecastWeighted - mock.crmForecastWeighted;
  const pctToGoal = mock.quota > 0 ? mock.aiForecastWeighted / mock.quota : null;
  const leftToGo = mock.quota - mock.aiForecastWeighted;

  const radarDeals: RadarDeal[] = (() => {
    const colors = palette.chartSeries.length ? palette.chartSeries : ["#7C3AED", "#2563EB", "#16A34A", "#F59E0B", "#EF4444"];
    return mock.dealsDrivingGap.slice(0, 20).map((d, idx) => ({
      id: d.id,
      label: String(d.account_name || "").trim() || "(Account)",
      legendLabel: `${String(d.account_name || "").trim() || "(Account)"} — ${String(d.opportunity_name || "").trim() || "Deal"}`,
      color: colors[idx % colors.length] || "#7C3AED",
      meddpicc_tb: (d.meddpicc_tb || []).map((c) => ({ key: String(c.key || "").trim(), score: c.score == null ? null : Number(c.score) })),
    }));
  })();

  const missing = {
    quarterSummary: {
      cro: ["Forecast accuracy (last quarter vs actuals) + bias by stage/rep", "Stage-to-stage conversion rates (by segment/region)", "Pipeline required-to-win math (needed pipeline, needed wins, required ACV)"],
      ceo: ["Bookings vs revenue vs ARR view (multi-quarter) + retention impact", "Board-ready trend lines (QoQ/YoY) and budget variance", "Top company risks/opportunities: churn, expansion, new logos"],
      svp: ["Rep productivity (pipeline created/rep/week), capacity, hiring plan", "Activity coverage (meetings, exec touches) tied to outcomes", "Deal inspection queue: next steps due, stalled deals, coaching prompts"],
    },
    forecastBuckets: {
      cro: ["Opp counts + avg ACV per bucket + reliability by bucket (historical)", "Push/slip risk (close-date movement) per bucket", "Override/audit trail for stage changes and probability edits"],
      ceo: ["Single-number forecast + range (p10/p50/p90) for board", "Scenario planning (if-then: pull 3 deals in Commit, what happens?)"],
      svp: ["Bucket hygiene: missing close dates, missing amounts, stale stages", "Rep/manager accountability: bucket owners and commit call notes"],
    },
    pipelineCoverage: {
      cro: ["Coverage computed on remaining quota (net of won) + by segment/region/team", "Coverage trend weekly + required pipeline creation pacing", "Whitespace analysis (top accounts with low pipeline vs plan)"],
      ceo: ["Next-quarter and 2-quarter-forward coverage view", "Constraint view: capacity vs demand (headcount, ramp, quota)"],
      svp: ["Coverage by manager + rep, with coaching targets", "Stage aging bands by bucket and by rep (stalls)"],
    },
    aiVsCrm: {
      cro: ["Explainability: which deals drive AI delta (already partially covered) + why", "Governance: allow/deny manual overrides; log and approvals", "Probability sensitivity: show what changes if stage probs change"],
      ceo: ["Board narrative: why AI differs, and what actions close the gap", "Confidence intervals not just point estimates"],
      svp: ["Rep coaching: attach insights to deals with next-step owners + due dates", "Escalation triggers: suppressed deals in Best Case, low-health Commit"],
    },
    createdMix: {
      cro: ["Created pipeline by source/channel/segment (new logos vs expansion)", "Create→Win conversion by cohort (this-quarter created)", "Carryover vs new split + impact on next quarter"],
      ceo: ["New logo vs expansion mix (strategic growth) + retention offset", "Marketing/partner contribution to created pipeline"],
      svp: ["Pipeline gen per rep + target pacing; coverage gaps by territory", "Stage distribution of created pipeline (quality, not just quantity)"],
    },
    velocity: {
      cro: ["Stage velocity (time in stage) + bottleneck detection", "Close-date slippage heatmap and push reasons", "Cycle time distribution (p50/p80), not just averages"],
      ceo: ["Operational cadence: expected close timing vs plan for the quarter", "Execution risk summary: what breaks the plan"],
      svp: ["Stalled deal list by rep with coaching playbooks", "Exit criteria enforcement per stage (MEDDPICC completeness)"],
    },
    topAccounts: {
      cro: ["Account plan signals: exec sponsor, renewal dates, whitespace, next meeting", "At-risk revenue by account + mitigation plan owners", "Account coverage: pipeline vs quota allocation by account tier"],
      ceo: ["Strategic accounts: top 10 narrative, risks, and growth opportunities", "Competitive displacement opportunities"],
      svp: ["Account drills: meetings, champions, next steps, mutual close plan", "Territory/account assignments and ownership clarity"],
    },
    riskRadar: {
      cro: ["Risk severity weighting (downside dollars), not just counts", "Risk by bucket/rep/segment and trend over time", "Suppression reasons + remediation workflow"],
      ceo: ["Company-level risk narrative + mitigation plan", "Top systemic gaps (product, pricing, competition)"],
      svp: ["Coaching queue from MEDDPICC gaps with suggested questions", "Rep enablement actions per risk category"],
    },
    dealsDrivingGap: {
      cro: ["Close date + probability delta + last activity + next step due date", "Ownership + escalation path (who is accountable)", "What-if actions: fix 1 gap, how much forecast moves"],
      ceo: ["Top 5 deal narratives with board-level risk posture", "Dependencies (legal, security, procurement) flagged early"],
      svp: ["Coaching details: MEDDPICC evidence, call notes, action checklist", "Stalled deal alerts and step-by-step rescue plan"],
    },
    productMix: {
      cro: ["Margin/discount + price realization by product", "Attach/cross-sell opportunities and packaging levers", "Product churn/renewal risk by line (if applicable)"],
      ceo: ["Strategic mix vs plan (what we want to sell) + GTM implications", "Product concentration risk and growth thesis"],
      svp: ["Enablement: which plays lift ACV in low-ACV lines", "Rep/product performance breakdown to target coaching"],
    },
    directVsPartner: {
      cro: ["Partner-sourced vs partner-influenced split", "Cycle time and slip rate by motion", "Partner ROI: pipeline created, win rate, and enablement needs"],
      ceo: ["Channel strategy: investment recommendation + expected yield", "Partner concentration risk and strategic bets"],
      svp: ["Partner coaching queue (registration, joint calls, enablement)", "Coverage: direct+partner mix targets by segment/region"],
    },
    cei: {
      cro: ["CEI trend over time + what drives it (velocity, win rate, health)", "Investment actions per partner tier (maintain/invest/deprioritize)", "Partner pipeline coverage vs quota contribution targets"],
      ceo: ["Strategic partner story: where we win and where to invest", "Board-ready narrative on channel leverage"],
      svp: ["Operational playbooks per partner: enablement, joint pipeline, QBR cadence", "Partner-level deal inspection queue"],
    },
  } as const;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Sandbox · Isolated test dashboard</div>
        <div className="mt-1 text-lg font-semibold text-[color:var(--sf-text-primary)]">TestExecutiveDashboard</div>
        <div className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Mock data only · No production dashboards modified · Visual inspection route: <span className="font-mono">/test-dashboard</span>
        </div>
      </div>

      <div className="grid gap-4">
        <section className="w-full rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,620px)] lg:items-start">
            <div className="min-w-0">
              <div className="flex items-center justify-center">
                <div className="relative w-[320px] max-w-[85vw] shrink-0 aspect-[1024/272] sm:w-[420px]">
                  <Image
                    src="/brand/logooutlook.png"
                    alt="SalesForecast.io Outlook"
                    fill
                    sizes="(min-width: 640px) 420px, 320px"
                    className="origin-center scale-90 object-contain"
                    priority={true}
                  />
                </div>
              </div>

              <div className="mt-4">
                <div className="text-left">
                  <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quarter End Outlook</div>
                  <div className="mt-1 text-kpiHero text-[color:var(--sf-text-primary)]">
                    {pctToGoal == null || !Number.isFinite(pctToGoal) ? "—" : `${Math.round(pctToGoal * 100)}%`}
                  </div>
                </div>

                <div className="mt-2 flex items-end gap-[2px]" aria-hidden="true">
                  {(() => {
                    const segments = 52;
                    const pct = pctToGoal == null ? 0 : clamp01(pctToGoal);
                    const filled = Math.round(pct * segments);
                    const minH = 10;
                    const maxH = 34;
                    const exp = 3.6;
                    return Array.from({ length: segments }).map((_, i) => {
                      const t = segments <= 1 ? 1 : i / (segments - 1);
                      const bg = i < filled ? "var(--sf-accent-primary)" : "var(--sf-surface-alt)";
                      const h = minH + (maxH - minH) * Math.pow(t, exp);
                      return (
                        <div
                          key={i}
                          className="w-[12px] rounded-[3px] border border-[color:var(--sf-border)]"
                          style={{ background: bg, height: `${Math.round(h)}px` }}
                        />
                      );
                    });
                  })()}
                </div>

                <div className="mt-5">
                  <span className="inline-flex rounded-full border border-[#F1C40F]/50 bg-[#F1C40F]/12 px-3 py-1 text-meta font-[500] text-[#F1C40F]">
                    Confidence: Moderate Risk
                  </span>
                </div>
              </div>
            </div>

            <div className="min-w-0 lg:pt-1">
              <div className="ml-auto grid max-w-[560px] gap-3 sm:grid-cols-2">
                {[
                  { label: "Closed Won (QTD)", cur: fmtMoney0(mock.productKpis.total_revenue), prev: fmtMoney0(mock.productKpisPrev.total_revenue) },
                  { label: "Total Orders", cur: String(mock.productKpis.total_orders), prev: String(mock.productKpisPrev.total_orders) },
                  { label: "Blended ACV", cur: fmtMoney0(mock.productKpis.blended_acv), prev: fmtMoney0(mock.productKpisPrev.blended_acv) },
                  { label: "Avg Health Closed Won", cur: `${mock.quarterHealthKpis.avgHealthWonPct}%`, prev: "" },
                  { label: "Opp→Win Conversion", cur: `${mock.quarterHealthKpis.oppToWinPct}%`, prev: "" },
                  { label: "Avg Health Closed Loss", cur: `${mock.quarterHealthKpis.avgHealthLostPct}%`, prev: "" },
                ].map((k) => (
                  <div key={k.label} className="h-full rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                    <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">{k.label}</div>
                    <div className="mt-2 text-kpiValue text-[color:var(--sf-text-primary)]">{k.cur}</div>
                    {k.prev ? <div className="mt-1 text-meta">Last Quarter {k.prev}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 shadow-sm">
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Days Aging</div>
                <div className="mt-1 text-tableLabel">Closed Won</div>
                <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">{mock.quarterHealthKpis.wonAvgDays} days</div>
              </div>

              <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-4 py-3 shadow-sm">
                <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Avg Days Aging</div>
                <div className="mt-1 text-tableLabel">Remaining Pipeline</div>
                <div className="mt-2 text-kpiSupport text-[color:var(--sf-text-primary)]">{mock.quarterHealthKpis.agingAvgDays} days</div>
              </div>
            </div>

            <ExecutiveRemainingQuarterlyForecastBlock crmTotals={mock.crmTotals} quota={mock.quota} pipelineMomentum={mock.pipelineMomentum as any} />

            <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-5">
              <div className="inline-flex items-center gap-2 text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">
                <span>✨ Strategic Takeaway (mock)</span>
              </div>
              <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
                We are {fmtMoney0(Math.abs(leftToGo))} short of quota on an AI-weighted basis. Downside is concentrated in Commit; 1–2 saves can close most of the gap. If pipeline creation stays down QoQ, next quarter’s coverage will be at risk—prioritize net-new pipeline.
              </div>
            </div>
          </div>
        </section>

        <PurpleAddOn
          title="What’s missing to make this executive view complete (CRO / CEO / SVP Sales)"
          subtitle="This is a build checklist only (mock). Additions are boxed purple so they can be evaluated without changing production dashboards."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-purple-500/30 bg-white/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">
                <li>Forecast accuracy + bias by stage/rep</li>
                <li>Slippage (close-date movement) and push reasons</li>
                <li>Coverage and pipeline creation pacing by segment/region/team</li>
                <li>Governance: overrides, approvals, and audit trail</li>
              </ul>
            </div>
            <div className="rounded-lg border border-purple-500/30 bg-white/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">
                <li>Multi-quarter board view (bookings/revenue/ARR)</li>
                <li>Budget variance + scenario ranges (p10/p50/p90)</li>
                <li>Retention/churn and expansion mix narrative</li>
                <li>Top strategic account story + competitive themes</li>
              </ul>
            </div>
            <div className="rounded-lg border border-purple-500/30 bg-white/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">
                <li>Rep productivity + capacity (pipeline created/rep/week)</li>
                <li>Stalled deal queue + next steps due + coaching actions</li>
                <li>Stage velocity + bottlenecks by manager/rep</li>
                <li>Activity coverage tied to outcomes</li>
              </ul>
            </div>
          </div>
        </PurpleAddOn>

        <div className="mt-1">
          <KpiCardsRow
            quota={mock.quota}
            aiForecast={mock.aiForecastWeighted}
            crmForecast={mock.crmForecastWeighted}
            gap={gap}
            bucketDeltas={mock.bucketDeltas}
            dealsAtRisk={mock.dealsAtRisk}
            topN={5}
            usingFullRiskSet={true}
            productKpis={mock.productKpis}
            productKpisPrev={mock.productKpisPrev}
            variant="forecast_only"
          />
        </div>

        <PurpleAddOn title="Forecast Buckets + Coverage completeness" subtitle="These are the standard CRO-grade “make it actionable” fields.">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.forecastBuckets.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.forecastBuckets.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.forecastBuckets.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <div className="mt-1">
          <ExecutiveQuarterKpisModule
            period={{
              id: "test-qpid",
              fiscal_year: period.fiscal_year,
              fiscal_quarter: period.fiscal_quarter,
              period_name: period.period_name,
              period_start: period.period_start,
              period_end: period.period_end,
            }}
            quota={mock.quota}
            pipelineMomentum={mock.pipelineMomentum as any}
            crmTotals={mock.crmTotals}
            quarterKpis={{
              winRate: 0.61,
              wonCount: 13,
              lostCount: 8,
              aov: 112_923,
              avgHealthWonPct: mock.quarterHealthKpis.avgHealthWonPct,
              avgHealthLostPct: mock.quarterHealthKpis.avgHealthLostPct,
              oppToWin: 0.21,
              wonAvgDays: mock.quarterHealthKpis.wonAvgDays,
              agingAvgDays: mock.quarterHealthKpis.agingAvgDays,
              directVsPartner: {
                directWonAmount: mock.motionPerformance.direct.revenue,
                partnerWonAmount: mock.motionPerformance.partner.revenue,
                directClosedDeals: 8,
                directAov: 94_625,
                directAvgAgeDays: 132,
                partnerContributionPct: 0.48,
                partnerClosedDeals: 7,
                partnerAov: 101_571,
                partnerAvgAgeDays: 155,
                partnerWinRate: 0.83,
              },
              createdPipeline: {
                commitAmount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.commit.value,
                commitCount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.commit.opps,
                commitHealthPct: mock.pipelineMomentum.predictive.created_pipeline.current.mix.commit.health_pct,
                bestAmount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.best_case.value,
                bestCount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.best_case.opps,
                bestHealthPct: mock.pipelineMomentum.predictive.created_pipeline.current.mix.best_case.health_pct,
                pipelineAmount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.pipeline.value,
                pipelineCount: mock.pipelineMomentum.predictive.created_pipeline.current.mix.pipeline.opps,
                pipelineHealthPct: mock.pipelineMomentum.predictive.created_pipeline.current.mix.pipeline.health_pct,
                totalAmount: mock.pipelineMomentum.predictive.created_pipeline.current.total_amount,
                totalCount: mock.pipelineMomentum.predictive.created_pipeline.current.total_opps,
                totalHealthPct: 13,
                mixCommit: 0.18,
                mixBest: 0.29,
                mixPipeline: 0.32,
              },
              createdPipelineByManager: [],
            }}
            repRollups={null}
            productsClosedWon={null}
          />
        </div>

        <PurpleAddOn title="Created-In-Quarter + Velocity completeness">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">Created-In-Quarter Mix</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.createdMix.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">Pipeline Velocity</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.velocity.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <section className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="grid gap-2">
            <div className="text-cardLabel uppercase text-[color:var(--sf-text-secondary)]">Quick Account Review - Top 20 (mock)</div>
          </div>
          <div className="mt-3">
            <div className="text-meta font-[500]">Accounts</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[color:var(--sf-text-primary)]">
              {radarDeals.length ? (
                radarDeals.slice(0, 20).map((d) => (
                  <div key={d.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1">
                    <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--sf-border)]" style={{ background: d.color }} aria-hidden="true" />
                    <span className="min-w-0 max-w-[260px] truncate" title={String(d.legendLabel || d.label)}>
                      {String(d.legendLabel || d.label)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-[color:var(--sf-text-secondary)]">No at-risk deals in the current view.</div>
              )}
            </div>
          </div>
        </section>

        <RiskRadarPlot deals={radarDeals} size={960} />

        <Card title="AI Risk Radar (Strategic Takeaway)" subtitle="Mock narrative—no API calls.">
          <div className="rounded-lg border border-[color:var(--sf-border)] bg-white p-3 text-sm text-black">
            The risk set contains {mock.dealsAtRisk} at-risk deals with total downside concentrated in Commit. Primary MEDDPICC gaps are Pain, Metrics, and Champion. A single save in the top 1–2 deals can cover most of the gap; prioritize executive access and close-plan discipline.
          </div>
          <div className="mt-4">
            <PurpleAddOn title="Risk Radar completeness">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
                  <ul className="mt-2 list-disc pl-5 text-sm">{missing.riskRadar.cro.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
                  <ul className="mt-2 list-disc pl-5 text-sm">{missing.riskRadar.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
                  <ul className="mt-2 list-disc pl-5 text-sm">{missing.riskRadar.svp.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              </div>
            </PurpleAddOn>
          </div>
        </Card>

        <ExecutiveDealsDrivingGapModule title="Deals Driving the Gap" deals={toExecutiveGapDeals()} />

        <PurpleAddOn title="Deals Driving the Gap completeness">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.dealsDrivingGap.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.dealsDrivingGap.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.dealsDrivingGap.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <Card title="Product Revenue Mix" subtitle="Mock data only.">
          <div className="grid gap-3 lg:grid-cols-3">
            {mock.productRevenueMix.map((p) => (
              <div key={p.product} className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[color:var(--sf-text-primary)]">{p.product}</div>
                    <div className="mt-2">
                      <span className="inline-flex rounded-full border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--sf-text-secondary)]">
                        {p.note}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">% of Mix</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtPct(p.mix_pct)}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sf-text-secondary)]">Revenue (Closed Won)</div>
                  <div className="mt-1 font-mono text-xs font-semibold text-[color:var(--sf-text-primary)]">{fmtMoney0(p.revenue)}</div>
                </div>

                <div className="mt-3 grid gap-2 text-meta">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span>Volume</span>
                    <span className="font-mono font-[600] text-[color:var(--sf-text-primary)]">{p.volume}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span>Avg. Deal Size</span>
                    <span className="font-mono font-[600] text-[color:var(--sf-text-primary)]">{fmtMoney0(p.avg_deal_size)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span>Deal Health</span>
                    <span className={["font-mono font-[700]", productMixTone(p.health_pct)].join(" ")}>{p.health_label} ({p.health_pct}%)</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <PurpleAddOn title="Product Mix completeness">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.productMix.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.productMix.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.productMix.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Direct vs. Indirect Performance" subtitle="Mock snapshot.">
            <SimpleTable
              columns={["Motion", "Win Rate", "Avg Health", "Revenue", "Mix"]}
              rows={[
                ["Direct", `${mock.motionPerformance.direct.win_rate_pct}%`, `${mock.motionPerformance.direct.avg_health_pct}%`, fmtMoney0(mock.motionPerformance.direct.revenue), `${mock.motionPerformance.direct.mix_pct}%`],
                ["Partner", `${mock.motionPerformance.partner.win_rate_pct}%`, `${mock.motionPerformance.partner.avg_health_pct}%`, fmtMoney0(mock.motionPerformance.partner.revenue), `${mock.motionPerformance.partner.mix_pct}%`],
              ]}
            />
            <div className="mt-3 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
              <div className="font-semibold">Direct Vs. Indirect Performance (delta)</div>
              <div className="mt-1 text-meta">
                Win Rate{" "}
                <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                  {mock.motionPerformance.direct.win_rate_pct - mock.motionPerformance.partner.win_rate_pct}pp
                </span>{" "}
                · Avg Health{" "}
                <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                  {mock.motionPerformance.direct.avg_health_pct - mock.motionPerformance.partner.avg_health_pct}pp
                </span>{" "}
                · Revenue{" "}
                <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">
                  {fmtSignedMoney0(mock.motionPerformance.direct.revenue - mock.motionPerformance.partner.revenue)}
                </span>
              </div>
            </div>
          </Card>

          <Card title="CEI Partner Scoring" subtitle="Mock scoring view.">
            <div className="grid gap-3">
              <div className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-3">
                <div className="text-tableLabel">CEI Status</div>
                <div className="mt-1 font-mono text-tableValue text-[color:var(--sf-text-primary)]">{mock.cei.status}</div>
                <div className="mt-1 text-meta">
                  Partner CEI <span className="font-mono font-semibold text-[color:var(--sf-text-primary)]">{mock.cei.partner_index}</span> (Direct = 100) ·{" "}
                  <span className="font-semibold">{mock.cei.confidence}</span> · Based on {mock.cei.based_on_deals} partner closed-won deal(s)
                </div>
              </div>

              <SimpleTable
                columns={["Partner", "Verdict", "WIC", "PQS", "Trend"]}
                rows={mock.cei.wic_pqs.map((r) => [r.partner, r.verdict, r.wic, r.pqs == null ? "—" : r.pqs, r.trend])}
              />

              <div className="text-xs text-[color:var(--sf-text-secondary)]">
                Canonical Scoring Engine (WIC / PQS / CEI) · Scores clamped 0–100. WIC computed for Direct + each partner. PQS computed per partner only.
              </div>
            </div>
          </Card>
        </div>

        <PurpleAddOn title="Direct vs Partner + CEI completeness">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">Direct vs Partner</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.directVsPartner.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEI / Partner scoring</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.cei.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <PurpleAddOn title="AI vs CRM completeness (governance + explainability)">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.aiVsCrm.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.aiVsCrm.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.aiVsCrm.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <PurpleAddOn title="Pipeline Coverage completeness">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.pipelineCoverage.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.pipelineCoverage.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.pipelineCoverage.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <PurpleAddOn title="Top Accounts completeness">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.topAccounts.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.topAccounts.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.topAccounts.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <PurpleAddOn title="Quarter Summary KPIs completeness">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CRO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.quarterSummary.cro.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">CEO</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.quarterSummary.ceo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">SVP Sales</div>
              <ul className="mt-2 list-disc pl-5 text-sm">{missing.quarterSummary.svp.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </PurpleAddOn>

        <PurpleAddOn title="This section is intentionally sandbox-only" subtitle="All purple boxes are new additions; the non-purple sections are intended to mirror the real Executive dashboard layout." >
          <div className="text-xs text-purple-700/80">
            No production code changed. This route renders mock data only and does not call executive APIs.
          </div>
        </PurpleAddOn>
      </div>
    </main>
  );
}

