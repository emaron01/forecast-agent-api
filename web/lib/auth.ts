import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "./pool";

export const runtime = "nodejs";

const USER_SESSION_COOKIE = "fa_session";
const MASTER_SESSION_COOKIE = "fa_master";
const MASTER_ORG_COOKIE = "fa_master_org";

const USER_SESSION_TTL_DAYS = 14;
const MASTER_SESSION_TTL_DAYS = 14;

export type AuthUser = {
  id: number;
  public_id: string;
  org_id: number;
  email: string;
  role: "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP";
  hierarchy_level: number;
  display_name: string;
  account_owner_name: string | null;
  manager_user_id: number | null;
  admin_has_full_analytics_access: boolean;
  see_all_visibility: boolean;
  active: boolean;
};

export type AuthContext =
  | { kind: "user"; user: AuthUser; session_token: string }
  | { kind: "master"; email: string; orgId: number | null };

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlEncodeString(s: string) {
  return b64urlEncode(Buffer.from(s, "utf8"));
}

function b64urlDecodeString(s: string) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = (s + pad).replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken() {
  return b64urlEncode(crypto.randomBytes(32));
}

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function sessionSecret() {
  const secret = env("SESSION_SECRET");
  if (!secret) throw new Error("SESSION_SECRET is required");
  return secret;
}

export function isMasterAdminEmail(email: string) {
  const master = env("MASTER_ADMIN_EMAIL").toLowerCase();
  if (!master) return false;
  return String(email || "").trim().toLowerCase() === master;
}

type MasterPayload = { email: string; exp: number };

function signMaster(payload: MasterPayload) {
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifyMaster(cookieValue: string | undefined | null): MasterPayload | null {
  const v = String(cookieValue || "");
  if (!v) return null;
  const [payloadB64, sig] = v.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(payloadB64).digest("base64url");
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecodeString(payloadB64)) as MasterPayload;
    if (!payload?.email || !payload?.exp) return null;
    if (Date.now() / 1000 > Number(payload.exp)) return null;
    if (!isMasterAdminEmail(payload.email)) return null;
    return { email: String(payload.email), exp: Number(payload.exp) };
  } catch {
    return null;
  }
}

export function setMasterSessionCookie(email: string) {
  const exp = Math.floor(Date.now() / 1000) + MASTER_SESSION_TTL_DAYS * 24 * 60 * 60;
  const value = signMaster({ email: String(email).trim().toLowerCase(), exp });
  cookies().set(MASTER_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MASTER_SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearMasterSessionCookie() {
  cookies().set(MASTER_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  cookies().set(MASTER_ORG_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export function setUserSessionCookie(token: string) {
  cookies().set(USER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: USER_SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearUserSessionCookie() {
  cookies().set(USER_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export function setMasterOrgCookie(orgId: number | null) {
  if (orgId == null) {
    cookies().set(MASTER_ORG_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return;
  }
  cookies().set(MASTER_ORG_COOKIE, String(orgId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MASTER_SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function getMasterOrgIdFromCookies() {
  const raw = cookies().get(MASTER_ORG_COOKIE)?.value || "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getAuth(): Promise<AuthContext | null> {
  const masterCookie = cookies().get(MASTER_SESSION_COOKIE)?.value;
  const master = verifyMaster(masterCookie);
  if (master) {
    return { kind: "master", email: master.email, orgId: getMasterOrgIdFromCookies() };
  }

  const sessionToken = cookies().get(USER_SESSION_COOKIE)?.value || "";
  if (!sessionToken) return null;
  const tokenHash = sha256Hex(sessionToken);

  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.public_id::text AS public_id,
      u.org_id,
      u.email,
      u.role,
      u.hierarchy_level,
      u.display_name,
      u.account_owner_name,
      u.manager_user_id,
      u.admin_has_full_analytics_access,
      u.see_all_visibility,
      u.active AS user_active,
      o.active AS org_active,
      s.expires_at,
      s.revoked_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN organizations o ON o.id = u.org_id
    WHERE s.session_token_hash = $1
    LIMIT 1
    `,
    [tokenHash]
  );

  const r = rows?.[0] as any;
  if (!r) return null;
  if (r.revoked_at) return null;
  if (!r.expires_at || new Date(r.expires_at).getTime() <= Date.now()) return null;
  if (!r.user_active || !r.org_active) return null;

  const user: AuthUser = {
    id: Number(r.id),
    public_id: String(r.public_id || ""),
    org_id: Number(r.org_id),
    email: String(r.email || ""),
    role: r.role as AuthUser["role"],
    hierarchy_level: Number(r.hierarchy_level ?? 0) || 0,
    display_name: String(r.display_name || ""),
    account_owner_name: r.account_owner_name == null ? null : String(r.account_owner_name || ""),
    manager_user_id: r.manager_user_id == null ? null : Number(r.manager_user_id),
    admin_has_full_analytics_access: !!r.admin_has_full_analytics_access,
    see_all_visibility: !!r.see_all_visibility,
    active: !!r.user_active,
  };

  return { kind: "user", user, session_token: sessionToken };
}

export async function requireAuth() {
  const ctx = await getAuth();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireAdminOrMaster() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") return ctx;
  if (ctx.user.role !== "ADMIN") redirect("/dashboard");
  return ctx;
}

export async function requireManagerAdminOrMaster() {
  const ctx = await requireAuth();
  if (ctx.kind === "master") return ctx;
  if (ctx.user.role !== "ADMIN" && ctx.user.role !== "EXEC_MANAGER" && ctx.user.role !== "MANAGER") redirect("/dashboard");
  return ctx;
}

export async function requireOrgContext() {
  const ctx = await requireAuth();
  if (ctx.kind === "user") return { ctx, orgId: ctx.user.org_id };
  const orgId = ctx.orgId;
  if (!orgId) redirect("/admin/organizations");
  return { ctx, orgId };
}

