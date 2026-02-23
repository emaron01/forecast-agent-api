export type TestQuarterPeriod = {
  fiscal_year: string;
  fiscal_quarter: string;
  period_name: string;
  period_start: string;
  period_end: string;
};

export type TestExecutiveDashboardMock = {
  title: string;
  period: TestQuarterPeriod;

  quota: number;
  crmForecastWeighted: number;
  aiForecastWeighted: number;
  bucketDeltas: { commit: number; best_case: number; pipeline: number };
  dealsAtRisk: number;

  productKpis: { total_revenue: number; total_orders: number; blended_acv: number };
  productKpisPrev: { total_revenue: number; total_orders: number; blended_acv: number };

  quarterHealthKpis: {
    avgHealthWonPct: number;
    oppToWinPct: number;
    avgHealthLostPct: number;
    wonAvgDays: number;
    agingAvgDays: number;
  };

  crmTotals: {
    commit_amount: number;
    best_case_amount: number;
    pipeline_amount: number;
    won_amount: number;
  };

  pipelineMomentum: {
    quota_target: number;
    current_quarter: {
      total_pipeline: number;
      total_opps: number;
      avg_health_pct: number | null;
      mix: {
        commit: { value: number; opps: number; qoq_change_pct: number | null; health_pct: number | null };
        best_case: { value: number; opps: number; qoq_change_pct: number | null; health_pct: number | null };
        pipeline: { value: number; opps: number; qoq_change_pct: number | null; health_pct: number | null };
      };
    };
    previous_quarter: { total_pipeline: number | null };
    predictive: {
      created_pipeline: {
        current: {
          total_amount: number;
          total_opps: number;
          created_won_amount: number;
          created_won_opps: number;
          created_lost_amount: number;
          created_lost_opps: number;
          total_amount_all: number;
          total_opps_all: number;
          mix: {
            commit: { value: number; opps: number; health_pct: number | null };
            best_case: { value: number; opps: number; health_pct: number | null };
            pipeline: { value: number; opps: number; health_pct: number | null };
          };
        };
        previous: {
          total_amount: number | null;
          total_opps: number | null;
          total_amount_all: number | null;
          total_opps_all: number | null;
        };
        qoq_total_amount_pct01: number | null;
        qoq_total_opps_pct01: number | null;
        qoq_total_amount_all_pct01: number | null;
        qoq_total_opps_all_pct01: number | null;
      };
      cycle_mix_created_pipeline: {
        avg_age_days: number | null;
        bands: Array<{ band: "0-30" | "31-60" | "61+"; opps: number; amount: number }>;
      };
    };
  };

  topAccounts: string[];

  aiRiskRadar: Array<{ key: string; label: string; count: number; tone: "bad" | "warn" | "good" | "muted" }>;

  dealsDrivingGap: Array<{
    id: string;
    risk: "High" | "Medium" | "Low" | "—";
    account_name: string;
    opportunity_name: string;
    rep_name: string;
    bucket_label: "Commit" | "Best Case" | "Pipeline";
    amount: number;
    health_pct: number | null;
    gap: number;
    meddpicc_tb: Array<{ key: string; score: number | null; score_label: string; tip: string | null; evidence: string | null }>;
    risk_flags: Array<{ key: string; label: string; tip: string | null }>;
    risk_summary: string | null;
    next_steps: string | null;
    suppression?: boolean;
    health_modifier?: number;
  }>;

  productRevenueMix: Array<{
    product: string;
    mix_pct: number;
    revenue: number;
    volume: number;
    avg_deal_size: number;
    health_label: string;
    health_pct: number;
    note: string;
  }>;

  motionPerformance: {
    direct: { win_rate_pct: number; avg_health_pct: number; revenue: number; mix_pct: number };
    partner: { win_rate_pct: number; avg_health_pct: number; revenue: number; mix_pct: number };
  };

  cei: {
    status: "HIGH" | "MEDIUM" | "LOW";
    partner_index: number;
    confidence: "MODERATE CONFIDENCE" | "HIGH CONFIDENCE" | "LOW CONFIDENCE";
    based_on_deals: number;
    wic_pqs: Array<{ partner: string; verdict: "MAINTAIN" | "DEPRIORITIZE" | "INVEST"; wic: number; pqs: number | null; trend: "↑" | "→" | "↓" }>;
  };
};

export const testExecutiveDashboardMock: TestExecutiveDashboardMock = {
  title: "SalesForecast.io Outlook",
  period: {
    fiscal_year: "2026",
    fiscal_quarter: "3",
    period_name: "3rd Quarter",
    period_start: "2026-01-01",
    period_end: "2026-03-31",
  },

  quota: 3_000_000,
  aiForecastWeighted: 2_840_054,
  crmForecastWeighted: 2_940_920,
  bucketDeltas: { commit: -100_867, best_case: 0, pipeline: 0 },
  dealsAtRisk: 7,

  productKpis: { total_revenue: 1_468_000, total_orders: 13, blended_acv: 112_923 },
  productKpisPrev: { total_revenue: 897_000, total_orders: 7, blended_acv: 128_143 },

  quarterHealthKpis: {
    avgHealthWonPct: 87,
    oppToWinPct: 21,
    avgHealthLostPct: 30,
    wonAvgDays: 113,
    agingAvgDays: 175,
  },

  crmTotals: {
    commit_amount: 1_201_221,
    best_case_amount: 684_212,
    pipeline_amount: 5_449_386,
    won_amount: 1_468_000,
  },

  pipelineMomentum: {
    quota_target: 2_000_000,
    current_quarter: {
      total_pipeline: 7_334_819,
      total_opps: 60,
      avg_health_pct: 13,
      mix: {
        commit: { value: 1_685_627, opps: 7, qoq_change_pct: 4, health_pct: 13 },
        best_case: { value: 2_739_365, opps: 15, qoq_change_pct: -2, health_pct: null },
        pipeline: { value: 2_950_577, opps: 38, qoq_change_pct: -15, health_pct: null },
      },
    },
    previous_quarter: { total_pipeline: 10_353_350 },
    predictive: {
      created_pipeline: {
        current: {
          total_amount: 7_375_569,
          total_opps: 60,
          created_won_amount: 1_675_000,
          created_won_opps: 15,
          created_lost_amount: 264_000,
          created_lost_opps: 8,
          total_amount_all: 9_314_569,
          total_opps_all: 83,
          mix: {
            commit: { value: 1_685_627, opps: 7, health_pct: 13 },
            best_case: { value: 2_739_365, opps: 15, health_pct: null },
            pipeline: { value: 2_950_577, opps: 38, health_pct: null },
          },
        },
        previous: {
          total_amount: 11_603_350,
          total_opps: 81,
          total_amount_all: 12_040_000,
          total_opps_all: 90,
        },
        qoq_total_amount_pct01: (9_314_569 - 11_603_350) / 11_603_350,
        qoq_total_opps_pct01: (60 - 81) / 81,
        qoq_total_amount_all_pct01: (9_314_569 - 12_040_000) / 12_040_000,
        qoq_total_opps_all_pct01: (83 - 90) / 90,
      },
      cycle_mix_created_pipeline: {
        avg_age_days: 42,
        bands: [
          { band: "0-30", opps: 24, amount: 2_180_000 },
          { band: "31-60", opps: 19, amount: 3_060_000 },
          { band: "61+", opps: 17, amount: 2_134_569 },
        ],
      },
    },
  },

  topAccounts: [
    "Oceancrest Rugby Club",
    "Metro Harbor Athletics",
    "Northshore Clippers",
    "Helix Manufacturing",
    "Windward Sailing League",
    "Crescent City Sailors",
    "Helix Manufacturing (EMEA)",
    "Hawthorne Steelworks",
    "Silverline Logistics",
    "Redwood Data Systems",
    "Metro Harbor Athletics (Expansion)",
    "Northshore Clippers (Renewal)",
    "Crescent City Sailors (Pilot)",
    "Oceancrest Rugby Club (Add-on)",
    "Summit Ridge Energy",
    "Stonebridge Medical",
    "Bluehaven Retail",
    "OrchardWorks",
    "IronPeak Construction",
    "Evergreen Motors",
  ],

  aiRiskRadar: [
    { key: "pain", label: "Pain", count: 9, tone: "bad" },
    { key: "metrics", label: "Metrics", count: 7, tone: "warn" },
    { key: "champion", label: "Champion", count: 6, tone: "warn" },
    { key: "economic_buyer", label: "Economic Buyer", count: 4, tone: "warn" },
    { key: "process", label: "Decision Process", count: 3, tone: "muted" },
    { key: "paper", label: "Paper Process", count: 2, tone: "muted" },
    { key: "competition", label: "Competition", count: 2, tone: "muted" },
    { key: "timing", label: "Timing", count: 1, tone: "good" },
    { key: "budget", label: "Budget", count: 1, tone: "good" },
  ],

  dealsDrivingGap: [
    {
      id: "test-opp-1",
      risk: "—",
      account_name: "Oceancrest Rugby Club",
      opportunity_name: "Discovery",
      rep_name: "Paul Smith",
      bucket_label: "Commit",
      amount: 225_000,
      health_pct: 87,
      gap: -18_000,
      suppression: false,
      health_modifier: 0.92,
      meddpicc_tb: [
        { key: "pain", score: 1, score_label: "Unscored / weak", tip: "Confirm quantified pain with the economic buyer.", evidence: "Pain statement is qualitative; no quantified impact." },
        { key: "metrics", score: 1, score_label: "Unscored / weak", tip: "Capture baseline metrics and target outcomes.", evidence: "Success metrics not documented in CRM notes." },
        { key: "champion", score: 2, score_label: "Developing", tip: "Identify an internal sponsor with political capital.", evidence: "Contact is supportive but not a champion." },
      ],
      risk_flags: [
        { key: "pain", label: "Pain: unscored", tip: "Add quantified pain + business impact." },
        { key: "metrics", label: "Metrics: unscored", tip: "Define success criteria and baseline." },
      ],
      risk_summary: "MEDDPICC gaps in Pain and Metrics reduce confidence despite Commit stage.",
      next_steps: "Schedule EB discovery; document quantified pain and success metrics; confirm champion ownership.",
    },
    {
      id: "test-opp-2",
      risk: "—",
      account_name: "Metro Harbor Athletics",
      opportunity_name: "New Business",
      rep_name: "Sara Jones",
      bucket_label: "Commit",
      amount: 225_000,
      health_pct: 87,
      gap: -18_000,
      suppression: false,
      health_modifier: 0.92,
      meddpicc_tb: [
        { key: "process", score: 1, score_label: "Undefined", tip: "Map decision steps + owners.", evidence: "No documented decision process." },
        { key: "economic_buyer", score: 1, score_label: "Unknown", tip: "Confirm EB identity and access.", evidence: "EB not identified in notes." },
      ],
      risk_flags: [
        { key: "economic_buyer", label: "Economic Buyer: unknown", tip: "Add EB contact + meeting plan." },
        { key: "process", label: "Decision Process: undefined", tip: "Capture steps, dates, owners." },
      ],
      risk_summary: "Commit deal lacks EB and decision process clarity, reducing AI-weighted outlook.",
      next_steps: "Get EB meeting on calendar; finalize decision process milestones; align paper process.",
    },
    {
      id: "test-opp-3",
      risk: "—",
      account_name: "Northshore Clippers",
      opportunity_name: "Renewal",
      rep_name: "Paul Smith",
      bucket_label: "Commit",
      amount: 204_000,
      health_pct: 87,
      gap: -16_320,
      suppression: false,
      health_modifier: 0.92,
      meddpicc_tb: [{ key: "criteria", score: 1, score_label: "Weak", tip: "Confirm decision criteria & scoring.", evidence: "Criteria not explicitly defined." }],
      risk_flags: [{ key: "criteria", label: "Criteria: weak", tip: "Document criteria and weighting." }],
      risk_summary: "Renewal is late-stage but criteria are not documented; risk of slippage.",
      next_steps: "Confirm renewal criteria and timeline; secure champion + procurement alignment.",
    },
    {
      id: "test-opp-4",
      risk: "High",
      account_name: "Helix Manufacturing",
      opportunity_name: "Helix Robotics Upgrade",
      rep_name: "Sales2 Rep2",
      bucket_label: "Commit",
      amount: 119_221,
      health_pct: null,
      gap: -14_307,
      suppression: true,
      health_modifier: 0,
      meddpicc_tb: [
        { key: "pain", score: 0, score_label: "Unscored", tip: "Revalidate pain and urgency.", evidence: "No pain evidence captured." },
        { key: "metrics", score: 0, score_label: "Unscored", tip: "Define measurable outcomes.", evidence: "Success metrics missing." },
        { key: "champion", score: 0, score_label: "Unscored", tip: "Secure champion sponsorship.", evidence: "No champion identified." },
      ],
      risk_flags: [
        { key: "suppressed", label: "Suppressed: excluded by health score rules", tip: "Deal suppressed by health-score rules; needs re-scoring." },
        { key: "pain", label: "Pain: unscored", tip: "Quantify pain and urgency." },
        { key: "metrics", label: "Metrics: unscored", tip: "Add baseline + target metrics." },
      ],
      risk_summary: "High-risk gaps (Pain/Metrics/Champion) cause suppression, driving downside in Commit.",
      next_steps: "Coach rep on MEDDPICC basics; capture pain, metrics, and champion; remove suppression by improving health score.",
    },
    {
      id: "test-opp-5",
      risk: "—",
      account_name: "Windward Sailing League",
      opportunity_name: "Pilot",
      rep_name: "Sara Jones",
      bucket_label: "Commit",
      amount: 147_000,
      health_pct: 87,
      gap: -11_760,
      suppression: false,
      health_modifier: 0.92,
      meddpicc_tb: [{ key: "timing", score: 1, score_label: "At risk", tip: "Lock mutual close plan.", evidence: "Close plan not confirmed." }],
      risk_flags: [{ key: "timing", label: "Timing: at risk", tip: "Finalize close plan milestones." }],
      risk_summary: "Pilot timing is the primary risk; a slip would widen the gap materially.",
      next_steps: "Finalize mutual close plan; confirm paper process steps; schedule exec alignment.",
    },
  ],

  productRevenueMix: [
    { product: "Endpoint", mix_pct: 41, revenue: 607_000, volume: 4, avg_deal_size: 151_750, health_label: "Good", health_pct: 87, note: "Pricing power" },
    { product: "Migrate", mix_pct: 30, revenue: 443_000, volume: 4, avg_deal_size: 110_750, health_label: "Balanced", health_pct: 87, note: "Balanced" },
    { product: "Availability", mix_pct: 28, revenue: 418_000, volume: 5, avg_deal_size: 83_600, health_label: "Good", health_pct: 87, note: "Effort gap" },
  ],

  motionPerformance: {
    direct: { win_rate_pct: 47, avg_health_pct: 30, revenue: 757_000, mix_pct: 52 },
    partner: { win_rate_pct: 83, avg_health_pct: 77, revenue: 711_000, mix_pct: 48 },
  },

  cei: {
    status: "HIGH",
    partner_index: 244,
    confidence: "MODERATE CONFIDENCE",
    based_on_deals: 5,
    wic_pqs: [
      { partner: "Direct", verdict: "MAINTAIN", wic: 55, pqs: null, trend: "↑" },
      { partner: "CDW", verdict: "DEPRIORITIZE", wic: 28, pqs: 48, trend: "→" },
      { partner: "MSFT", verdict: "MAINTAIN", wic: 45, pqs: 62, trend: "→" },
      { partner: "SHI", verdict: "MAINTAIN", wic: 47, pqs: 51, trend: "→" },
      { partner: "Computer Resell", verdict: "DEPRIORITIZE", wic: 39, pqs: 42, trend: "→" },
    ],
  },
};

