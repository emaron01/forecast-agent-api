export function buildTools() {
  const scoreInt = { type: "integer", minimum: 0, maximum: 3 };
  return [
    {
      type: "function",
      name: "save_deal_data",
      description:
        "REQUIRED after EVERY rep answer. Save the score (0-3), summary, and coaching tip for the category you just asked about.",
      parameters: {
        type: "object",
        properties: {
          pain_score: scoreInt,
          pain_summary: { type: "string" },
          pain_tip: { type: "string" },
          metrics_score: scoreInt,
          metrics_summary: { type: "string" },
          metrics_tip: { type: "string" },
          champion_score: scoreInt,
          champion_summary: { type: "string" },
          champion_tip: { type: "string" },
          champion_name: { type: "string" },
          champion_title: { type: "string" },
          eb_score: scoreInt,
          eb_summary: { type: "string" },
          eb_tip: { type: "string" },
          eb_name: { type: "string" },
          eb_title: { type: "string" },
          criteria_score: scoreInt,
          criteria_summary: { type: "string" },
          criteria_tip: { type: "string" },
          process_score: scoreInt,
          process_summary: { type: "string" },
          process_tip: { type: "string" },
          competition_score: scoreInt,
          competition_summary: { type: "string" },
          competition_tip: { type: "string" },
          paper_score: scoreInt,
          paper_summary: { type: "string" },
          paper_tip: { type: "string" },
          timing_score: scoreInt,
          timing_summary: { type: "string" },
          timing_tip: { type: "string" },
          budget_score: scoreInt,
          budget_summary: { type: "string" },
          budget_tip: { type: "string" },
          risk_summary: { type: "string" },
          next_steps: { type: "string" },
          rep_comments: { type: "string" },
        },
        required: [],
      },
      // Keep non-strict to match current behavior (optional fields).
      strict: false,
    },
    {
      type: "function",
      name: "advance_deal",
      description: "Advance to the next deal after end-of-deal wrap.",
      parameters: { type: "object", properties: {} },
      strict: false,
    },
  ];
}

