import type { Pool } from "pg";
import { sessions } from "../agent/sessions";
import { runResponsesTurn } from "../../../lib/responsesTurn";
import { handsfreeRuns, type HandsFreeRun } from "./runs";

const KICKOFF_TEXT =
  "Begin the forecast review now. Follow the workflow. Start with your greeting and immediately ask the first MEDDPICC gap question for the first deal.";

function append(run: HandsFreeRun, role: "assistant" | "user" | "system", text: string) {
  const t = String(text || "").trim();
  if (!t) return;
  run.messages.push({ role, text: t, at: Date.now() });
  run.updatedAt = Date.now();
}

function lastNonEmptyLine(text: string) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) || "";
}

function shouldPauseForUser(assistantText: string) {
  const last = lastNonEmptyLine(assistantText);
  if (!last) return false;
  // Pause only if the last line is a short, direct question.
  if (last.length <= 650 && /\?\s*$/.test(last)) return true;
  // Some models include the question earlier and end with a brief instruction.
  // If there is a question very near the end, still pause.
  const tail = String(assistantText || "").slice(-800);
  if (tail.includes("?")) return true;
  return false;
}

export async function runUntilPauseOrEnd(args: {
  pool: Pool;
  runId: string;
  userText?: string;
  kickoff?: boolean;
}): Promise<HandsFreeRun> {
  const run = handsfreeRuns.get(args.runId);
  if (!run) throw new Error("Invalid runId");

  // Re-entrancy guard: avoid interleaving messages/state.
  if (run.inFlight) return run;
  run.inFlight = true;

  try {
    try {
      const session = sessions.get(run.sessionId);
      if (!session) throw new Error("Invalid session for run");

      run.status = "RUNNING";
      run.error = undefined;
      run.waitingPrompt = undefined;
      run.updatedAt = Date.now();

      // User input is a conditional interrupt, not the default driver.
      const userText = String(args.userText || "").trim();
      if (userText) append(run, "user", userText);

      // Safety guards: avoid runaway model loops.
      // Latency is a product requirement: reps won't wait for multi-call "autopilot" after each answer.
      // Keep turns tight: normally we expect a single call to save + ask the next question.
      const maxModelCallsThisInvocation = args.kickoff ? 8 : 2;
      const maxTotalModelCalls = 250;

      let nextText = args.kickoff
        ? `${KICKOFF_TEXT}\n\nUser context:\n${userText || "(none)"}`
        : userText;
      let calls = 0;

      while (calls < maxModelCallsThisInvocation) {
        calls += 1;
        run.modelCalls += 1;
        if (run.modelCalls > maxTotalModelCalls) {
          run.status = "ERROR";
          run.error = "Safety stop: model call limit exceeded.";
          run.updatedAt = Date.now();
          return run;
        }

        const r = await runResponsesTurn({
          pool: args.pool,
          session,
          text: nextText,
        });
        const assistantText = r.assistantText || "";
        const done = !!r.done;

        if (assistantText) append(run, "assistant", assistantText);

        if (done) {
          run.status = "DONE";
          run.updatedAt = Date.now();
          return run;
        }

        // Product guard: the kickoff must always hand the turn to the rep after the first assistant message,
        // even if the model didn't end with a clean question marker. This prevents "intro + wrap" runs.
        if (args.kickoff && calls === 1) {
          run.status = "WAITING_FOR_USER";
          run.waitingPrompt = assistantText || "Please reply to continue.";
          run.updatedAt = Date.now();
          return run;
        }

        // Pause only on a short direct question on the last non-empty line.
        if (shouldPauseForUser(assistantText)) {
          run.status = "WAITING_FOR_USER";
          run.waitingPrompt = assistantText;
          run.updatedAt = Date.now();
          return run;
        }

        // No obvious question; one quick corrective retry (kept bounded by maxModelCallsThisInvocation).
        nextText = args.kickoff
          ? "Proceed to the next workflow step."
          : "Ask the next required question now. Do not summarize; keep it to one direct question.";
      }

      // If we hit our guard without reaching a pause/end, fail safe by pausing.
      run.status = "WAITING_FOR_USER";
      run.waitingPrompt = run.messages.filter((m) => m.role === "assistant").at(-1)?.text || "Please reply to continue.";
      run.updatedAt = Date.now();
      return run;
    } catch (e: any) {
      run.status = "ERROR";
      run.error = String(e?.message || e);
      run.updatedAt = Date.now();
      return run;
    }
  } finally {
    run.inFlight = false;
  }
}

