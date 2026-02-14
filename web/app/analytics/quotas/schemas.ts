import { z } from "zod";

export type ActionOk<T> = { ok: true; data: T };
export type ActionErr = { ok: false; error: string };
export type ActionResult<T> = ActionOk<T> | ActionErr;

const zBigintText = z.string().regex(/^\d+$/);
const zUuidText = z.string().uuid();
const zFiscalYear = z.string().min(1);
const zFiscalQuarter = z.string().min(1);
const zDateText = z.string().min(1);

export const CreateQuotaPeriodSchema = z.object({
  period_name: z.string().min(1),
  period_start: zDateText,
  period_end: zDateText,
  fiscal_year: zFiscalYear,
  fiscal_quarter: zFiscalQuarter,
});

export const UpdateQuotaPeriodSchema = CreateQuotaPeriodSchema.extend({
  id: zBigintText,
});

export const AssignQuotaToUserSchema = z.object({
  quota_period_id: zBigintText,
  role_level: z.coerce.number().int(),
  rep_id: zBigintText.optional(),
  manager_id: zBigintText.optional(),
  quota_amount: z.coerce.number(),
  annual_target: z.coerce.number().optional(),
  carry_forward: z.coerce.number().optional(),
  adjusted_quarterly_quota: z.coerce.number().optional(),
});

export const UpdateQuotaSchema = AssignQuotaToUserSchema.extend({
  id: zUuidText,
});

export const GetQuotaByUserSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  quota_period_id: zBigintText,
});

export const GetQuotaPeriodsSchema = z.object({});
export const GetDistinctFiscalYearsSchema = z.object({});

export const GetQuotaRollupByManagerSchema = z.object({
  quota_period_id: zBigintText,
});

export const GetQuotaRollupCompanySchema = z.object({
  quota_period_id: zBigintText,
});

