import { z } from "zod";
import { HIERARCHY, isExecManagerLevel, isManagerLevel, roleToHierarchyLevel } from "./roleHelpers";

/**
 * External request validation schemas (PUBLIC surfaces).
 *
 * Rule: any identifier coming from a client (URLs, query params, request bodies, forms) must be a UUID public id:
 * - `public_id` / `*_public_id` fields are always `z.string().uuid()`
 * - never accept internal numeric ids in these schemas
 *
 * See `docs/ID_POLICY.md`.
 */

export const LoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().min(1),
});

export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8),
    confirm_password: z.string().min(8),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_password"], message: "passwords do not match" });
    }
  });

export const UpdatePasswordSchema = z
  .object({
    current_password: z.string().min(1),
    new_password: z.string().min(8),
    confirm_password: z.string().min(8),
  })
  .superRefine((v, ctx) => {
    if (v.new_password !== v.confirm_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_password"], message: "passwords do not match" });
    }
  });

export const ManagerVisibilitySchema = z.object({
  see_all_visibility: z.boolean(),
  visible_user_public_ids: z.array(z.string().uuid()).default([]),
});

export const CreateUserSchema = z
  .object({
    org_public_id: z.string().uuid().optional(),
    email: z.string().min(1),
    role: z.enum([
      "ADMIN",
      "EXEC_MANAGER",
      "MANAGER",
      "REP",
      "CHANNEL_EXECUTIVE",
      "CHANNEL_DIRECTOR",
      "CHANNEL_REP",
    ]),
    hierarchy_level: z.number().int().min(0).max(8).optional(),
    account_owner_name: z.string().optional(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    password: z.string().min(8),
    confirm_password: z.string().min(8),
    see_all_visibility: z.boolean().default(false),
    visible_user_public_ids: z.array(z.string().uuid()).default([]),
    active: z.boolean().default(true),
    admin_has_full_analytics_access: z.boolean().default(false),
    manager_user_public_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_password"], message: "passwords do not match" });
    }

    const expectedLevel = roleToHierarchyLevel(v.role) ?? HIERARCHY.REP;
    const effectiveLevel = v.hierarchy_level == null ? expectedLevel : v.hierarchy_level;
    if (v.hierarchy_level != null && v.hierarchy_level !== expectedLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["hierarchy_level"],
        message: `hierarchy_level must be ${expectedLevel} for role ${v.role}`,
      });
    }

    const crm = String(v.account_owner_name || "").trim();
    if (effectiveLevel === 3 && !crm) {
      ctx.addIssue({ code: "custom", path: ["account_owner_name"], message: "account_owner_name is required for REPs" });
    }

    if (effectiveLevel === 2 && !v.see_all_visibility && v.visible_user_public_ids.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["visible_user_public_ids"],
        message: "MANAGER must have visibility assignments unless see_all_visibility is enabled",
      });
    }

    const seeAllAllowed =
      isManagerLevel(effectiveLevel) ||
      isExecManagerLevel(effectiveLevel) ||
      effectiveLevel === HIERARCHY.CHANNEL_EXEC ||
      (effectiveLevel === HIERARCHY.ADMIN && v.admin_has_full_analytics_access);
    if (!seeAllAllowed && v.see_all_visibility) {
      ctx.addIssue({
        code: "custom",
        path: ["see_all_visibility"],
        message:
          "see_all_visibility is only valid for MANAGER, EXEC_MANAGER, CHANNEL_EXECUTIVE, or Executive Dashboard Admin",
      });
    }
  });

export const UpdateUserSchema = z
  .object({
    public_id: z.string().uuid(),
    email: z.string().min(1).optional(),
    role: z.enum([
      "ADMIN",
      "EXEC_MANAGER",
      "MANAGER",
      "REP",
      "CHANNEL_EXECUTIVE",
      "CHANNEL_DIRECTOR",
      "CHANNEL_REP",
    ]),
    hierarchy_level: z.number().int().min(0).max(8).optional(),
    account_owner_name: z.string().optional(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    see_all_visibility: z.boolean().default(false),
    visible_user_public_ids: z.array(z.string().uuid()).default([]),
    active: z.boolean().default(true),
    admin_has_full_analytics_access: z.boolean().default(false),
    manager_user_public_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const expectedLevel = roleToHierarchyLevel(v.role) ?? HIERARCHY.REP;
    const effectiveLevel = v.hierarchy_level == null ? expectedLevel : v.hierarchy_level;
    if (v.hierarchy_level != null && v.hierarchy_level !== expectedLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["hierarchy_level"],
        message: `hierarchy_level must be ${expectedLevel} for role ${v.role}`,
      });
    }

    const crm = String(v.account_owner_name || "").trim();
    if (effectiveLevel === 3 && !crm) {
      ctx.addIssue({ code: "custom", path: ["account_owner_name"], message: "account_owner_name is required for REPs" });
    }

    if (effectiveLevel === 2 && !v.see_all_visibility && v.visible_user_public_ids.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["visible_user_public_ids"],
        message: "MANAGER must have visibility assignments unless see_all_visibility is enabled",
      });
    }
  });

