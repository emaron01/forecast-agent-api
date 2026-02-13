export type CanonicalCategoryKey =
  | "metrics"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "pain"
  | "champion"
  | "competition"
  | "timing"
  | "budget";

export const MEDDPICC_CANONICAL: Record<
  CanonicalCategoryKey,
  {
    // Must match the user-provided canonical label line EXACTLY.
    titleLine: string;
    // Must match the user-provided meaning line EXACTLY.
    meaningLine: string;
  }
> = {
  metrics: {
    titleLine: "Metrics – Business Impact",
    meaningLine: "Quantifies the measurable upside",
  },
  economic_buyer: {
    titleLine: "Economic Buyer – Decision Power",
    meaningLine: "Identifies who truly controls the spend",
  },
  criteria: {
    titleLine: "Decision Criteria – How They Choose",
    meaningLine: "What matters most in their evaluation",
  },
  process: {
    titleLine: "Decision Process – How They Buy",
    meaningLine: "Steps, approvals, sequencing",
  },
  paper: {
    titleLine: "Paper Process – Procurement Path",
    meaningLine: "Legal, security, and vendor steps required",
  },
  pain: {
    titleLine: "Pain – Why It Matters",
    meaningLine: "The core problem and urgency",
  },
  champion: {
    titleLine: "Champion – Internal Advocate",
    meaningLine: "Who is pushing internally and why",
  },
  competition: {
    titleLine: "Competition – Alternatives in Play",
    meaningLine: "Who else they are considering",
  },
  timing: {
    titleLine: "Timeline – Why Now",
    meaningLine: "Trigger event, deadline, or forcing function",
  },
  budget: {
    titleLine: "Budget – Available Funding",
    meaningLine: "Do they have access to funds to purchase",
  },
};

