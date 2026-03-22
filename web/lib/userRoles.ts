/**
 * Channel hierarchy (see hierarchy_levels 6–8):
 * - CHANNEL_EXECUTIVE: full analytics, see-all visibility; optional manager_user_id aligns data scope
 * - CHANNEL_DIRECTOR: aligned to sales leader (manager is MANAGER), no see-all
 * - CHANNEL_REP: channel dashboard only (narrow UI), no see-all
 */

export type ChannelRole = "CHANNEL_EXECUTIVE" | "CHANNEL_DIRECTOR" | "CHANNEL_REP";

export const CHANNEL_ROLES: readonly ChannelRole[] = [
  "CHANNEL_EXECUTIVE",
  "CHANNEL_DIRECTOR",
  "CHANNEL_REP",
] as const;

export function isChannelRole(role: string | null | undefined): role is ChannelRole {
  const r = String(role || "").trim();
  return (CHANNEL_ROLES as readonly string[]).includes(r);
}

/** Level 8 — channel dash only (no full executive hero / tabs). */
export function isChannelRepOnly(role: string | null | undefined): boolean {
  return String(role || "").trim() === "CHANNEL_REP";
}

/** Redirect to main /dashboard like a sales REP (not channel landing). */
export function isRepLikeForMainDashboard(role: string | null | undefined): boolean {
  const r = String(role || "").trim();
  return r === "REP" || r === "CHANNEL_REP";
}

/** Blocked from org-wide analytics hubs (same as REP + channel rep). */
export function isAnalyticsRepLikeRedirect(role: string | null | undefined): boolean {
  const r = String(role || "").trim();
  return r === "REP" || r === "CHANNEL_REP";
}

export function channelRoleHierarchyLevel(role: ChannelRole): number {
  if (role === "CHANNEL_EXECUTIVE") return 6;
  if (role === "CHANNEL_DIRECTOR") return 7;
  return 8;
}

/** DB `users.hierarchy_level` for each `users.role` (includes channel 6–8). */
export function roleHierarchyLevel(role: string): number {
  switch (String(role || "").trim()) {
    case "ADMIN":
      return 0;
    case "EXEC_MANAGER":
      return 1;
    case "MANAGER":
      return 2;
    case "REP":
      return 3;
    case "CHANNEL_EXECUTIVE":
      return 6;
    case "CHANNEL_DIRECTOR":
      return 7;
    case "CHANNEL_REP":
      return 8;
    default:
      return 3;
  }
}

/** Human-readable role labels for UI (admin, selects, etc.). */
export function roleLabel(role: string): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "EXEC_MANAGER":
      return "Executive Manager";
    case "MANAGER":
      return "Manager";
    case "REP":
      return "Rep";
    case "CHANNEL_EXECUTIVE":
      return "Channel Executive";
    case "CHANNEL_DIRECTOR":
      return "Channel Director";
    case "CHANNEL_REP":
      return "Channel Rep";
    default:
      return role;
  }
}
