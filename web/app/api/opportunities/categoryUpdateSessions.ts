// In-memory session storage for Category Update mode.
// Uses a global to survive Next.js hot reloads in dev.

export type CategoryKey =
  | "metrics"
  | "economic_buyer"
  | "criteria"
  | "process"
  | "paper"
  | "pain"
  | "champion"
  | "competition"
  | "timing"
  | "budget";

export type CategoryUpdateSession = {
  sessionId: string;
  orgId: number;
  opportunityId: number;
  category: CategoryKey;
  createdAt: number;
  updatedAt: number;
  turns: Array<{ role: "assistant" | "user" | "system"; text: string; at: number }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __categoryUpdateSessions__: Map<string, CategoryUpdateSession> | undefined;
}

export const categoryUpdateSessions: Map<string, CategoryUpdateSession> =
  global.__categoryUpdateSessions__ || (global.__categoryUpdateSessions__ = new Map());

