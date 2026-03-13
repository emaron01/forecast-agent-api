"use server";

import { requireAuth } from "../../lib/auth";
import { pool } from "../../lib/pool";
import type { ExecTabKey } from "./execTabConstants";

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
