export type HandsFreeStatus = "RUNNING" | "WAITING_FOR_USER" | "DONE" | "ERROR";

export type HandsFreeMessage = {
  role: "assistant" | "user" | "system";
  text: string;
  at: number;
};

export type HandsFreeRun = {
  runId: string;
  sessionId: string;
  status: HandsFreeStatus;
  // Increments every time the server enters WAITING_FOR_USER.
  // Used to deterministically drop stale/late transcripts.
  waitingSeq?: number;
  waitingPrompt?: string;
  error?: string;
  // Prompt versioning (recorded at start; prompt content is cached on session).
  masterPromptSha256?: string;
  masterPromptLoadedAt?: number;
  // Re-entrancy / concurrency guard for runUntilPauseOrEnd.
  inFlight?: boolean;
  messages: HandsFreeMessage[];
  modelCalls: number;
  updatedAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __handsfreeRuns__: Map<string, HandsFreeRun> | undefined;
}

export const handsfreeRuns = global.__handsfreeRuns__ || (global.__handsfreeRuns__ = new Map<string, HandsFreeRun>());

