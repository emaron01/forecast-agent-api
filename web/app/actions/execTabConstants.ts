export const EXEC_TABS = [
  "forecast",
  "pipeline",
  "coaching",
  "team",
  "channel",
  "revenue_mix",
  "revenue_intelligence",
  "top_deals",
  "report_builder",
  "reports",
] as const;
export type ExecTabKey = (typeof EXEC_TABS)[number];

export function normalizeExecTab(raw: string | null | undefined): ExecTabKey | null {
  const v = String(raw || "").trim().toLowerCase();
  // Legacy tab key (renamed to revenue_mix)
  if (v === "revenue") return "revenue_mix";
  return EXEC_TABS.includes(v as ExecTabKey) ? (v as ExecTabKey) : null;
}
