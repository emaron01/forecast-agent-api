import type { AuthUser } from "./auth";

// Hierarchy levels:
// 0 = Admin
// 1 = Exec Manager
// 2 = Manager
// 3 = Rep
// 6 = Channel Exec
// 7 = Channel Director/Manager
// 8 = Channel Rep
export const HIERARCHY = {
  ADMIN: 0,
  EXEC_MANAGER: 1,
  MANAGER: 2,
  REP: 3,
  CHANNEL_EXEC: 6,
  CHANNEL_MANAGER: 7,
  CHANNEL_REP: 8,
} as const;

export type HierarchyLevel = (typeof HIERARCHY)[keyof typeof HIERARCHY];

type UserWithHierarchy = Pick<AuthUser, "hierarchy_level">;

function levelOf(u: UserWithHierarchy) {
  return Number(u.hierarchy_level);
}

export function roleToHierarchyLevel(role: string | null | undefined): HierarchyLevel | null {
  switch (String(role || "").trim()) {
    case "ADMIN":
      return HIERARCHY.ADMIN;
    case "EXEC_MANAGER":
      return HIERARCHY.EXEC_MANAGER;
    case "MANAGER":
      return HIERARCHY.MANAGER;
    case "REP":
      return HIERARCHY.REP;
    case "CHANNEL_EXECUTIVE":
      return HIERARCHY.CHANNEL_EXEC;
    case "CHANNEL_DIRECTOR":
      return HIERARCHY.CHANNEL_MANAGER;
    case "CHANNEL_REP":
      return HIERARCHY.CHANNEL_REP;
    default:
      return null;
  }
}

export function isAdminLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.ADMIN;
}

export function isExecManagerLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.EXEC_MANAGER;
}

export function isManagerLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.MANAGER;
}

export function isRepLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.REP;
}

export function isChannelExecLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.CHANNEL_EXEC;
}

export function isChannelManagerLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.CHANNEL_MANAGER;
}

export function isChannelRepLevel(level: number | null | undefined) {
  return Number(level) === HIERARCHY.CHANNEL_REP;
}

/** True only for channel hierarchy levels 6 / 7 / 8 — not `>= 6` (avoids catching unknown future levels). */
export function isChannelRoleLevel(level: number | null | undefined) {
  const n = Number(level);
  return n === HIERARCHY.CHANNEL_EXEC || n === HIERARCHY.CHANNEL_MANAGER || n === HIERARCHY.CHANNEL_REP;
}

export function isSalesLeaderLevel(level: number | null | undefined) {
  return Number(level) >= HIERARCHY.EXEC_MANAGER && Number(level) <= HIERARCHY.MANAGER;
}

export function isAdmin(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.ADMIN;
}

export function isExecManager(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.EXEC_MANAGER;
}

export function isManager(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.MANAGER;
}

export function isRep(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.REP;
}

export function isChannelExec(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.CHANNEL_EXEC;
}

export function isChannelManager(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.CHANNEL_MANAGER;
}

export function isChannelRep(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.CHANNEL_REP;
}

/** Channel Executive / Director / Rep only (6, 7, 8). Sales levels 0–5 never match. */
export function isChannelRole(u: UserWithHierarchy) {
  return isChannelRoleLevel(levelOf(u));
}

/**
 * Partitions AI takeaway cache so channel roles (6/7/8) never share cached copy with sales-side roles (0–5),
 * even if payload SHA collides.
 */
export function aiTakeawayCacheHierarchyGroup(u: UserWithHierarchy): "channel" | "sales" {
  return isChannelRole(u) ? "channel" : "sales";
}

export function isSalesLeader(u: UserWithHierarchy) {
  return levelOf(u) >= HIERARCHY.EXEC_MANAGER && levelOf(u) <= HIERARCHY.MANAGER;
}

export function isSalesRep(u: UserWithHierarchy) {
  return levelOf(u) === HIERARCHY.REP;
}

export function isSalesRole(u: UserWithHierarchy) {
  return levelOf(u) >= HIERARCHY.EXEC_MANAGER && levelOf(u) <= HIERARCHY.REP;
}

export function canSeeFullOrg(u: UserWithHierarchy) {
  return isAdmin(u) || isExecManager(u) || isChannelExec(u);
}

export function canSeeTeam(u: UserWithHierarchy) {
  return levelOf(u) <= HIERARCHY.MANAGER || isChannelManager(u);
}

export function requiresManagerScope(u: UserWithHierarchy) {
  return isManager(u) || isChannelManager(u);
}

// SQL helper — returns hierarchy levels for sales roles only (excludes channel)
export const SALES_HIERARCHY_LEVELS = [0, 1, 2, 3];

// SQL helper — channel hierarchy levels
export const CHANNEL_HIERARCHY_LEVELS = [6, 7, 8];

// SQL helper — all hierarchy levels
export const ALL_HIERARCHY_LEVELS = [0, 1, 2, 3, 6, 7, 8];

/** User levels allowed to use org-wide `see_all_visibility` on executive-style dashboards (DB enforces validity). */
export const EXEC_SEE_ALL_VISIBILITY_LEVELS: readonly number[] = [
  HIERARCHY.ADMIN,
  HIERARCHY.EXEC_MANAGER,
  HIERARCHY.MANAGER,
  HIERARCHY.CHANNEL_EXEC,
  HIERARCHY.CHANNEL_MANAGER,
] as const;

export function isExecSeeAllVisibilityEligibleLevel(level: number | null | undefined) {
  const n = Number(level);
  return Number.isFinite(n) && EXEC_SEE_ALL_VISIBILITY_LEVELS.includes(n);
}
