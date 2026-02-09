import "server-only";

import bcrypt from "bcryptjs";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string) {
  const p = String(plain || "");
  if (!p) throw new Error("password is required");
  return await bcrypt.hash(p, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string) {
  const p = String(plain || "");
  const h = String(hash || "");
  if (!p || !h) return false;
  return await bcrypt.compare(p, h);
}

