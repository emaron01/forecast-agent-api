"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { pool } from "../../lib/pool";
import { hashPassword } from "../../lib/password";

const UserInputSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "REP"]),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  account_owner_name: z.string().optional(),
  manager_email: z.string().optional(),
});

const SignupSchema = z.object({
  org_name: z.string().min(1),
  users: z.array(UserInputSchema).min(1),
});

function normalizeEmail(s: string) {
  return String(s || "").trim().toLowerCase();
}

function redirectError(code: string) {
  redirect(`/signup?error=${encodeURIComponent(code)}`);
}

function isNextRedirectError(e: unknown) {
  return typeof (e as any)?.digest === "string" && String((e as any).digest).startsWith("NEXT_REDIRECT");
}

async function hasColumn(c: any, table: string, column: string) {
  const { rows } = await c.query(
    `
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1
    `,
    [table, column]
  );
  return !!rows?.length;
}

export async function signupAction(formData: FormData) {
  try {
    const org_name = String(formData.get("org_name") || "").trim();
    const usersRaw = String(formData.get("usersJson") || "").trim();
    let usersJson: unknown = null;
    try {
      usersJson = usersRaw ? JSON.parse(usersRaw) : null;
    } catch {
      redirectError("invalid_request");
    }

    const parsed = SignupSchema.safeParse({ org_name, users: usersJson });
    if (!parsed.success) redirectError("invalid_request");

    const users = parsed.data.users.map((u) => {
      const email = normalizeEmail(u.email);
      const manager_email = u.manager_email ? normalizeEmail(u.manager_email) : "";
      return {
        ...u,
        email,
        manager_email: manager_email || undefined,
      };
    });

    // Must include at least one ADMIN user.
    if (!users.some((u) => u.role === "ADMIN")) throw new Error("At least one ADMIN user is required");

    // Ensure unique emails within request.
    const seen = new Set<string>();
    for (const u of users) {
      if (!u.email) throw new Error("email is required");
      if (seen.has(u.email)) throw new Error("Duplicate email in user list");
      seen.add(u.email);
    }

    // Hash passwords up-front.
    const passwordHashes = await Promise.all(users.map((u) => hashPassword(u.password)));

    const c = await pool.connect();
    try {
      await c.query("BEGIN");

      // Validate required schema early so we can return an actionable message.
      const requiredUserCols = ["password_hash", "display_name", "account_owner_name", "active", "updated_at"];
      for (const col of requiredUserCols) {
        if (!(await hasColumn(c, "users", col))) {
          redirectError("schema_mismatch");
        }
      }

      // Org name collisions (your DB has a unique constraint on organizations.name).
      const orgExists = await c.query(`SELECT 1 FROM organizations WHERE lower(name) = lower($1) LIMIT 1`, [
        parsed.data.org_name,
      ]);
      if (orgExists.rows?.length) redirectError("org_taken");

      // Insert using only the universally-present column(s) to avoid mismatches across environments.
      const orgRes = await c.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [parsed.data.org_name]);
      const orgId = Number(orgRes.rows?.[0]?.id || 0);
      if (!orgId) throw new Error("Failed to create organization");

      // Global-unique email: fail early with a friendly message.
      const emails = users.map((u) => u.email);
      const existing = await c.query(`SELECT email FROM users WHERE email = ANY($1::text[]) LIMIT 1`, [emails]);
      if (existing.rows?.length) {
        redirectError("email_taken");
      }

      // Create users with manager_user_id initially NULL. We'll update REPs after inserts.
      const inserted: Array<{ id: number; email: string; role: "ADMIN" | "MANAGER" | "REP" }> = [];
      for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const password_hash = passwordHashes[i];
        const display_name = `${String(u.first_name || "").trim()} ${String(u.last_name || "").trim()}`.trim();
        if (!display_name) redirectError("invalid_request");
        const hierarchy_level = u.role === "ADMIN" ? 0 : u.role === "MANAGER" ? 2 : 3;
        const account_owner_name = String(u.account_owner_name || "").trim() || null;
        if (hierarchy_level === 3 && !account_owner_name) throw new Error("REP account_owner_name is required");
        const res = await c.query(
          `
          INSERT INTO users
            (org_id, email, password_hash, role, hierarchy_level, first_name, last_name, display_name, account_owner_name, manager_user_id, active, created_at, updated_at)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,TRUE,NOW(),NOW())
          RETURNING id, email, role
          `,
          [orgId, u.email, password_hash, u.role, hierarchy_level, u.first_name, u.last_name, display_name, account_owner_name]
        );
        inserted.push({
          id: Number(res.rows?.[0]?.id || 0),
          email: normalizeEmail(String(res.rows?.[0]?.email || "")),
          role: res.rows?.[0]?.role,
        });
      }

      const byEmail = new Map<string, { id: number; role: "ADMIN" | "MANAGER" | "REP" }>(
        inserted.map((r) => [r.email, { id: r.id, role: r.role }])
      );

      for (const u of users) {
        if (u.role !== "REP") continue;
        if (!u.manager_email) continue;

        const repRow = byEmail.get(u.email);
        const mgrRow = byEmail.get(u.manager_email);
        if (!repRow) throw new Error("Internal error: missing inserted rep user");
        if (!mgrRow || mgrRow.role !== "MANAGER") throw new Error("REP manager must be a MANAGER user in this signup list");

        await c.query(`UPDATE users SET manager_user_id = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`, [
          orgId,
          repRow.id,
          mgrRow.id,
        ]);
      }

      await c.query("COMMIT");

      redirect(`/login?created=1`);
    } catch (e) {
      await c.query("ROLLBACK");
      if (isNextRedirectError(e)) throw e;
      const msg = String((e as any)?.message || "");
      // Most common production case: email uniqueness conflict.
      if (String((e as any)?.code || "") === "23505") redirectError("email_taken");
      if (String((e as any)?.code || "") === "42703") redirectError("schema_mismatch"); // undefined_column
      if (String((e as any)?.code || "") === "42P01") redirectError("schema_mismatch"); // undefined_table
      if (msg.includes("ADMIN user is required")) redirectError("invalid_request");
      if (msg.includes("Duplicate email")) redirectError("invalid_request");
      if (msg.includes("REP manager")) redirectError("invalid_request");
      redirectError("unknown");
    } finally {
      c.release();
    }
  } catch (e) {
    if (isNextRedirectError(e)) throw e;
    redirectError("unknown");
  }
}

