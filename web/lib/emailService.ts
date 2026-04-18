// web/lib/emailService.ts
// DO NOT import from muscle.js, prompts/, or any scoring module.
// This file has one job: send emails. Nothing else.

import nodemailer from "nodemailer";
import { pool } from "./pool";

export type EmailTemplateType = "admin_welcome" | "user_welcome" | "password_reset";

export interface SendEmailParams {
  orgId?: number;
  userId?: number;
  templateType: EmailTemplateType;
  to: string;
  variables: Record<string, string>;
}

function compilePlaceholders(template: string, variables: Record<string, string>) {
  let out = String(template || "");
  for (const [k, v] of Object.entries(variables)) {
    const val = v == null ? "" : String(v);
    out = out.split(`{{${k}}}`).join(val);
  }
  return out;
}

function requiredSmtpEnv(): Record<string, string> | null {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_NAME", "SMTP_FROM_EMAIL"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = String(process.env[k] ?? "").trim();
    if (!v) return null;
    out[k] = v;
  }
  return out;
}

async function insertEmailLog(args: {
  orgId: number | null;
  userId: number | null;
  templateType: string;
  to_email: string;
  subject: string;
  status: "sent" | "failed";
  error_text: string | null;
}) {
  await pool
    .query(
      `
      INSERT INTO email_log (org_id, user_id, template_type, to_email, subject, status, error_text, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      [
        args.orgId,
        args.userId,
        args.templateType,
        args.to_email,
        args.subject,
        args.status,
        args.error_text,
      ]
    )
    .catch(() => null);
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const to = String(params.to || "").trim().toLowerCase();
  const templateType = params.templateType;

  try {
    if (!to) {
      await insertEmailLog({
        orgId: params.orgId ?? null,
        userId: params.userId ?? null,
        templateType,
        to_email: "",
        subject: "",
        status: "failed",
        error_text: "missing_recipient",
      });
      return;
    }

    if (templateType === "password_reset") {
      const { rows } = await pool
        .query(
          `
          SELECT COUNT(*)::int AS c
            FROM email_log
           WHERE to_email = $1
             AND template_type = 'password_reset'
             AND sent_at > NOW() - INTERVAL '1 hour'
          `,
          [to]
        )
        .catch(() => ({ rows: [{ c: 0 }] }));
      const c = Number((rows?.[0] as any)?.c || 0);
      if (c >= 3) {
        await insertEmailLog({
          orgId: params.orgId ?? null,
          userId: params.userId ?? null,
          templateType,
          to_email: to,
          subject: "",
          status: "failed",
          error_text: "rate_limit_exceeded",
        });
        return;
      }
    }

    const tplRes = await pool
      .query(
        `SELECT subject, body_html, body_text FROM email_templates WHERE template_type = $1 LIMIT 1`,
        [templateType]
      )
      .catch(() => ({ rows: [] as any[] }));
    const tpl = tplRes.rows?.[0] as { subject?: string; body_html?: string; body_text?: string } | undefined;
    if (!tpl || !tpl.subject || tpl.body_html == null || tpl.body_text == null) {
      await insertEmailLog({
        orgId: params.orgId ?? null,
        userId: params.userId ?? null,
        templateType,
        to_email: to,
        subject: "",
        status: "failed",
        error_text: "template_not_found",
      });
      return;
    }

    const smtp = requiredSmtpEnv();
    if (!smtp) {
      await insertEmailLog({
        orgId: params.orgId ?? null,
        userId: params.userId ?? null,
        templateType,
        to_email: to,
        subject: String(tpl.subject || "").slice(0, 500),
        status: "failed",
        error_text: "smtp_env_missing",
      });
      return;
    }

    const subject = compilePlaceholders(String(tpl.subject), params.variables);
    const html = compilePlaceholders(String(tpl.body_html), params.variables);
    const text = compilePlaceholders(String(tpl.body_text), params.variables);

    const port = parseInt(String(smtp.SMTP_PORT || "587"), 10);
    const secure = String(smtp.SMTP_SECURE || "").toLowerCase() === "true";

    const transporter = nodemailer.createTransport({
      host: smtp.SMTP_HOST,
      port,
      secure,
      auth: {
        user: smtp.SMTP_USER,
        pass: smtp.SMTP_PASS,
      },
    });

    const from = `${smtp.SMTP_FROM_NAME} <${smtp.SMTP_FROM_EMAIL}>`;

    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    await insertEmailLog({
      orgId: params.orgId ?? null,
      userId: params.userId ?? null,
      templateType,
      to_email: to,
      subject,
      status: "sent",
      error_text: null,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "unknown_error");
    try {
      await insertEmailLog({
        orgId: params.orgId ?? null,
        userId: params.userId ?? null,
        templateType,
        to_email: to,
        subject: "",
        status: "failed",
        error_text: msg.slice(0, 2000),
      });
    } catch {
      // ignore
    }
  }
}
