import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "../../../../../lib/auth";
import { pool } from "../../../../../lib/pool";

export const runtime = "nodejs";

const TemplateType = z.enum(["admin_welcome", "user_welcome", "password_reset"]);

const PutBody = z.object({
  subject: z.string().min(1),
  body_html: z.string().min(1),
  body_text: z.string().min(1),
});

export async function GET(_req: Request, ctx: { params: { type: string } }) {
  try {
    const auth = await getAuth();
    if (!auth || auth.kind !== "master") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const type = ctx.params.type;
    const parsedType = TemplateType.safeParse(type);
    if (!parsedType.success) return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });

    const { rows } = await pool.query(
      `SELECT template_type, subject, body_html, body_text, created_at, updated_at FROM email_templates WHERE template_type = $1 LIMIT 1`,
      [parsedType.data]
    );
    const row = rows?.[0];
    if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    return NextResponse.json({ ok: true, template: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: { params: { type: string } }) {
  try {
    const auth = await getAuth();
    if (!auth || auth.kind !== "master") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const type = ctx.params.type;
    const parsedType = TemplateType.safeParse(type);
    if (!parsedType.success) return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });

    const json = await req.json().catch(() => ({}));
    const parsed = PutBody.safeParse(json);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });

    const { rows } = await pool.query(
      `
      UPDATE email_templates
         SET subject = $2,
             body_html = $3,
             body_text = $4,
             updated_at = NOW()
       WHERE template_type = $1
       RETURNING template_type, subject, body_html, body_text, created_at, updated_at
      `,
      [parsedType.data, parsed.data.subject, parsed.data.body_html, parsed.data.body_text]
    );
    const row = rows?.[0];
    if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    return NextResponse.json({ ok: true, template: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
