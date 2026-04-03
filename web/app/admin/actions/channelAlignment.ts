"use server";

import { z } from "zod";
import { requireOrgContext } from "../../../lib/auth";
import { pool } from "../../../lib/pool";
import { isAdmin, isChannelExec, isChannelManager } from "../../../lib/roleHelpers";

type ChannelAlignmentRow = {
  id: string;
  org_id: string;
  channel_user_id: number;
  channel_user_name: string;
  channel_user_role: string | null;
  sales_leader_id: number;
  sales_leader_name: string;
  sales_leader_role: string | null;
  align_full_team: boolean;
  created_at: string;
  updated_at: string;
};

const SaveChannelAlignmentSchema = z.object({
  orgId: z.number().int().positive(),
  channelUserId: z.number().int().positive(),
  salesLeaderIds: z.array(z.number().int().positive()),
  alignFullTeam: z.boolean(),
});

const DeleteChannelAlignmentSchema = z.object({
  orgId: z.number().int().positive(),
  channelUserId: z.number().int().positive(),
  salesLeaderId: z.number().int().positive(),
});

function canManage(ctx: Awaited<ReturnType<typeof requireOrgContext>>["ctx"]) {
  return (
    ctx.kind === "master" ||
    (ctx.kind === "user" && (isAdmin(ctx.user) || isChannelExec(ctx.user) || isChannelManager(ctx.user)))
  );
}

async function canManageChannelUser(orgId: number, actingUserId: number, channelUserId: number) {
  const { rows } = await pool.query<{ ok: number }>(
    `
    SELECT 1 AS ok
      FROM users u
     WHERE u.org_id = $1::bigint
       AND u.id = $2::int
       AND u.manager_user_id = $3::int
       AND COALESCE(u.active, TRUE) IS TRUE
       AND COALESCE(u.hierarchy_level, 0) IN (6, 7, 8)
     LIMIT 1
    `,
    [orgId, channelUserId, actingUserId]
  );
  return !!rows?.length;
}

export async function listChannelAlignments(orgId: number): Promise<ChannelAlignmentRow[]> {
  const { ctx, orgId: scopedOrgId } = await requireOrgContext();
  if (!canManage(ctx)) return [];
  if (Number(orgId) !== Number(scopedOrgId)) return [];

  const { rows } = await pool.query<ChannelAlignmentRow>(
    `
    SELECT
      cta.id::text AS id,
      cta.org_id::text AS org_id,
      cta.channel_user_id,
      COALESCE(NULLIF(btrim(cu.display_name), ''), NULLIF(btrim(cu.email), ''), '(Unnamed)') AS channel_user_name,
      cu.role::text AS channel_user_role,
      cta.sales_leader_id,
      COALESCE(NULLIF(btrim(su.display_name), ''), NULLIF(btrim(su.email), ''), '(Unnamed)') AS sales_leader_name,
      su.role::text AS sales_leader_role,
      cta.align_full_team,
      cta.created_at::text AS created_at,
      cta.updated_at::text AS updated_at
    FROM channel_territory_alignments cta
    JOIN users cu
      ON cu.org_id = cta.org_id
     AND cu.id = cta.channel_user_id
    JOIN users su
      ON su.org_id = cta.org_id
     AND su.id = cta.sales_leader_id
    WHERE cta.org_id = $1::bigint
    ORDER BY channel_user_name ASC, sales_leader_name ASC, cta.id ASC
    `,
    [orgId]
  );

  return rows || [];
}

export async function saveChannelAlignment(args: {
  orgId: number;
  channelUserId: number;
  salesLeaderIds: number[];
  alignFullTeam: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { ctx, orgId } = await requireOrgContext();
    if (!canManage(ctx)) return { ok: false, error: "forbidden" };

    const parsed = SaveChannelAlignmentSchema.parse({
      orgId: Number(args.orgId),
      channelUserId: Number(args.channelUserId),
      salesLeaderIds: Array.isArray(args.salesLeaderIds) ? args.salesLeaderIds.map((id) => Number(id)) : [],
      alignFullTeam: !!args.alignFullTeam,
    });

    if (parsed.orgId !== Number(orgId)) return { ok: false, error: "invalid_org" };
    if (ctx.kind === "user" && !isAdmin(ctx.user)) {
      const allowed = await canManageChannelUser(parsed.orgId, ctx.user.id, parsed.channelUserId);
      if (!allowed) return { ok: false, error: "forbidden" };
    }

    const salesLeaderIds = Array.from(
      new Set(parsed.salesLeaderIds.filter((id) => Number.isFinite(id) && id > 0))
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
        DELETE FROM channel_territory_alignments
        WHERE org_id = $1::bigint
          AND channel_user_id = $2::int
        `,
        [parsed.orgId, parsed.channelUserId]
      );

      for (const salesLeaderId of salesLeaderIds) {
        await client.query(
          `
          INSERT INTO channel_territory_alignments (
            org_id,
            channel_user_id,
            sales_leader_id,
            align_full_team
          )
          VALUES ($1::bigint, $2::int, $3::int, $4::boolean)
          `,
          [parsed.orgId, parsed.channelUserId, salesLeaderId, parsed.alignFullTeam]
        );
      }

      await client.query("COMMIT");
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[saveChannelAlignment]", error);
      return { ok: false, error: "save_failed" };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[saveChannelAlignment]", error);
    return { ok: false, error: "invalid_request" };
  }
}

export async function deleteChannelAlignment(args: {
  orgId: number;
  channelUserId: number;
  salesLeaderId: number;
}): Promise<{ ok: boolean }> {
  try {
    const { ctx, orgId } = await requireOrgContext();
    if (!canManage(ctx)) return { ok: false };

    const parsed = DeleteChannelAlignmentSchema.parse({
      orgId: Number(args.orgId),
      channelUserId: Number(args.channelUserId),
      salesLeaderId: Number(args.salesLeaderId),
    });

    if (parsed.orgId !== Number(orgId)) return { ok: false };
    if (ctx.kind === "user" && !isAdmin(ctx.user)) {
      const allowed = await canManageChannelUser(parsed.orgId, ctx.user.id, parsed.channelUserId);
      if (!allowed) return { ok: false };
    }

    await pool.query(
      `
      DELETE FROM channel_territory_alignments
      WHERE org_id = $1::bigint
        AND channel_user_id = $2::int
        AND sales_leader_id = $3::int
      `,
      [parsed.orgId, parsed.channelUserId, parsed.salesLeaderId]
    );

    return { ok: true };
  } catch (error) {
    console.error("[deleteChannelAlignment]", error);
    return { ok: false };
  }
}
