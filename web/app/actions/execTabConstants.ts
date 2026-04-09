export const EXEC_TABS = [
  "overview",
  "pipeline",
  "sales_opportunities",
  "channel_performance",
  "my_focus",
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

/** Pick first valid tab from URL param, then saved preference, then fallback (all must be in allowed). */
export function resolveDashboardTab(args: {
  tabParam: ExecTabKey | null;
  prefTab: ExecTabKey | null;
  allowed: readonly ExecTabKey[];
  fallback: ExecTabKey;
}): ExecTabKey {
  const allowed = new Set(args.allowed);
  if (args.tabParam && allowed.has(args.tabParam)) return args.tabParam;
  if (args.prefTab && allowed.has(args.prefTab)) return args.prefTab;
  if (allowed.has(args.fallback)) return args.fallback;
  const first = args.allowed[0];
  return first ?? args.fallback;
}
