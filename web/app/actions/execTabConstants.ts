export const EXEC_TABS = ["forecast", "pipeline", "team", "revenue", "reports"] as const;
export type ExecTabKey = (typeof EXEC_TABS)[number];

export function normalizeExecTab(raw: string | null | undefined): ExecTabKey | null {
  const v = String(raw || "").trim().toLowerCase();
  return EXEC_TABS.includes(v as ExecTabKey) ? (v as ExecTabKey) : null;
}
