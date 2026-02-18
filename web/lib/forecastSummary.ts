export type CrmTotals = {
  commit: number;
  best_case: number;
  pipeline: number;
  won: number;
  quota: number;
};

export type OrgProbabilities = {
  commit_pct: number; // 0..1
  best_case_pct: number; // 0..1
  pipeline_pct: number; // 0..1
};

export type HealthModifiers = {
  commit_modifier: number; // >= 0
  best_case_modifier: number; // >= 0
  pipeline_modifier: number; // >= 0
};

export type SalesVsVerdictForecastSummary = {
  crm_totals: CrmTotals;
  verdict_totals: {
    commit: number;
    best_case: number;
    pipeline: number;
    won: number;
  };
  org_probabilities: OrgProbabilities;
  health_modifiers: HealthModifiers;
  weighted: {
    crm: {
      commit_weighted: number;
      best_case_weighted: number;
      pipeline_weighted: number;
      forecast: number;
    };
    verdict: {
      commit_weighted: number;
      best_case_weighted: number;
      pipeline_weighted: number;
      forecast: number;
    };
  };
  forecast_gap: number; // Verdict weighted forecast − CRM weighted forecast
};

function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(v: any) {
  const n = n0(v);
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function nonNeg(v: any) {
  const n = n0(v);
  return n < 0 ? 0 : n;
}

/**
 * Compute the Sales Forecast vs AI Forecast summary without blending.
 *
 * Definitions (authoritative):
 * - CRM Weighted Forecast = won + (commit × commit_pct) + (best_case × best_case_pct) + (pipeline × pipeline_pct)
 * - Verdict Weighted Forecast = won + ((commit × commit_modifier) × commit_pct) + ((best_case × best_case_modifier) × best_case_pct) + ((pipeline × pipeline_modifier) × pipeline_pct)
 * - Forecast Gap = Verdict Weighted Forecast − CRM Weighted Forecast
 */
export function computeSalesVsVerdictForecastSummary(args: {
  crm_totals: CrmTotals;
  org_probabilities: OrgProbabilities;
  health_modifiers: HealthModifiers;
}): SalesVsVerdictForecastSummary {
  const crm: CrmTotals = {
    commit: n0(args.crm_totals?.commit),
    best_case: n0(args.crm_totals?.best_case),
    pipeline: n0(args.crm_totals?.pipeline),
    won: n0(args.crm_totals?.won),
    quota: n0(args.crm_totals?.quota),
  };

  const probs: OrgProbabilities = {
    commit_pct: clamp01(args.org_probabilities?.commit_pct),
    best_case_pct: clamp01(args.org_probabilities?.best_case_pct),
    pipeline_pct: clamp01(args.org_probabilities?.pipeline_pct),
  };

  const mods: HealthModifiers = {
    commit_modifier: nonNeg(args.health_modifiers?.commit_modifier),
    best_case_modifier: nonNeg(args.health_modifiers?.best_case_modifier),
    pipeline_modifier: nonNeg(args.health_modifiers?.pipeline_modifier),
  };

  const crmCommitWeighted = crm.commit * probs.commit_pct;
  const crmBestWeighted = crm.best_case * probs.best_case_pct;
  const crmPipeWeighted = crm.pipeline * probs.pipeline_pct;
  const crmForecast = crm.won + crmCommitWeighted + crmBestWeighted + crmPipeWeighted;

  const verdictCommitBase = crm.commit * mods.commit_modifier;
  const verdictBestBase = crm.best_case * mods.best_case_modifier;
  const verdictPipeBase = crm.pipeline * mods.pipeline_modifier;

  const verdictCommitWeighted = verdictCommitBase * probs.commit_pct;
  const verdictBestWeighted = verdictBestBase * probs.best_case_pct;
  const verdictPipeWeighted = verdictPipeBase * probs.pipeline_pct;
  const verdictForecast = crm.won + verdictCommitWeighted + verdictBestWeighted + verdictPipeWeighted;

  const forecastGap = verdictForecast - crmForecast;

  return {
    crm_totals: crm,
    verdict_totals: {
      commit: verdictCommitBase,
      best_case: verdictBestBase,
      pipeline: verdictPipeBase,
      won: crm.won,
    },
    org_probabilities: probs,
    health_modifiers: mods,
    weighted: {
      crm: {
        commit_weighted: crmCommitWeighted,
        best_case_weighted: crmBestWeighted,
        pipeline_weighted: crmPipeWeighted,
        forecast: crmForecast,
      },
      verdict: {
        commit_weighted: verdictCommitWeighted,
        best_case_weighted: verdictBestWeighted,
        pipeline_weighted: verdictPipeWeighted,
        forecast: verdictForecast,
      },
    },
    forecast_gap: forecastGap,
  };
}

