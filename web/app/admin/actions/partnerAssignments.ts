"use server";

import { z } from "zod";
import { requireOrgContext } from "../../../lib/auth";
import { pool } from "../../../lib/pool";
import { isAdmin } from "../../../lib/roleHelpers";

type PartnerAssignmentRow = {
  id: string;
  org_id: string;
  partner_name: string;
  channel_rep_id: number;
  channel_rep_name: string;
  channel_rep_role: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerAssignmentsResult = {
  assignments: PartnerAssignmentRow[];
  unassignedPartners: string[];
};

const SavePartnerAssignmentSchema = z.object({
  orgId: z.number().int().positive(),
  partnerName: z.string().min(1),
  channelRepId: z.number().int().positive().nullable(),
});

function canManage(ctx: Awaited<ReturnType<typeof requireOrgContext>>["ctx"]) {
  return ctx.kind === "master" || (ctx.kind === "user" && isAdmin(ctx.user));
}

function normalizePartnerName(name: string) {
  return String(name || "").trim();
}

export async function listDistinctPartners(orgId: number): Promise<string[]> {
  const { ctx, orgId: scopedOrgId } = await requireOrgContext();
  if (!canManage(ctx)) return [];
  if (Number(orgId) !== Number(scopedOrgId)) return [];

  const { rows } = await pool.query<{ partner_name: string }>(
    `
    SELECT DISTINCT btrim(partner_name) AS partner_name
    FROM opportunities
    WHERE org_id = $1::bigint
      AND partner_name IS NOT NULL
      AND btrim(partner_name) <> ''
    ORDER BY partner_name ASC
    `,
    [orgId]
  );

  return (rows || []).map((row) => String(row.partner_name || "").trim()).filter(Boolean);
}

export async function listPartnerAssignments(orgId: number): Promise<PartnerAssignmentsResult> {
  const { ctx, orgId: scopedOrgId } = await requireOrgContext();
  if (!canManage(ctx)) return { assignments: [], unassignedPartners: [] };
  if (Number(orgId) !== Number(scopedOrgId)) return { assignments: [], unassignedPartners: [] };

  const [assignmentsRes, distinctPartners] = await Promise.all([
    pool.query<PartnerAssignmentRow>(
      `
      SELECT
        pca.id::text AS id,
        pca.org_id::text AS org_id,
        pca.partner_name,
        pca.channel_rep_id,
        COALESCE(NULLIF(btrim(u.display_name), ''), NULLIF(btrim(u.email), ''), '(Unnamed)') AS channel_rep_name,
        u.role::text AS channel_rep_role,
        pca.created_at::text AS created_at,
        pca.updated_at::text AS updated_at
      FROM partner_channel_assignments pca
      JOIN users u
        ON u.org_id = pca.org_id
       AND u.id = pca.channel_rep_id
      WHERE pca.org_id = $1::bigint
      ORDER BY pca.partner_name ASC, channel_rep_name ASC, pca.id ASC
      `,
      [orgId]
    ),
    listDistinctPartners(orgId),
  ]);

  const assignments = assignmentsRes.rows || [];
  const assignedPartners = new Set(assignments.map((row) => normalizePartnerName(row.partner_name).toLowerCase()));
  const unassignedPartners = distinctPartners.filter((partner) => !assignedPartners.has(normalizePartnerName(partner).toLowerCase()));

  return {
    assignments,
    unassignedPartners,
  };
}

export async function savePartnerAssignment(args: {
  orgId: number;
  partnerName: string;
  channelRepId: number | null; // null = unassign
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { ctx, orgId } = await requireOrgContext();
    if (!canManage(ctx)) return { ok: false, error: "forbidden" };

    const parsed = SavePartnerAssignmentSchema.parse({
      orgId: Number(args.orgId),
      partnerName: normalizePartnerName(args.partnerName),
      channelRepId: args.channelRepId == null ? null : Number(args.channelRepId),
    });

    if (parsed.orgId !== Number(orgId)) return { ok: false, error: "invalid_org" };

    if (!parsed.partnerName) return { ok: false, error: "partner_required" };

    if (parsed.channelRepId == null) {
      await pool.query(
        `
        DELETE FROM partner_channel_assignments
        WHERE org_id = $1::bigint
          AND partner_name = $2
        `,
        [parsed.orgId, parsed.partnerName]
      );

      return { ok: true };
    }

    await pool.query(
      `
      INSERT INTO partner_channel_assignments (
        org_id,
        partner_name,
        channel_rep_id
      )
      VALUES ($1::bigint, $2, $3::int)
      ON CONFLICT (org_id, partner_name)
      DO UPDATE SET
        channel_rep_id = EXCLUDED.channel_rep_id,
        updated_at = NOW()
      `,
      [parsed.orgId, parsed.partnerName, parsed.channelRepId]
    );

    return { ok: true };
  } catch (error) {
    console.error("[savePartnerAssignment]", error);
    return { ok: false, error: "save_failed" };
  }
}
