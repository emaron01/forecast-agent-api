"use server";

import { requireAuth } from "../../lib/auth";
import { pool } from "../../lib/pool";

export const EXEC_TABS = ["forecast", "pipeline", "team", "revenue", "reports"] as const;
export type ExecTabKey = (typeof EXEC_TABS)[number];

export function normalizeExecTab(raw: string | null | undefined): ExecTabKey | null {
  const v = String(raw || "").trim().toLowerCase();
  return EXEC_TABS.includes(v as ExecTabKey) ? (v as ExecTabKey) : null;
}

export async function setExecDefaultTabAction(tab: ExecTabKey) {
  const ctx = await requireAuth();
  if (ctx.kind !== "user") {
    throw new Error("Unauthorized");
  }
  await pool.query(
    `
    UPDATE users
       SET user_preferences = COALESCE(user_preferences, '{}'::jsonb) || jsonb_build_object('exec_default_tab', $2::text)
     WHERE id = $1::bigint
    `,
    [ctx.user.id, tab]
  );
}

