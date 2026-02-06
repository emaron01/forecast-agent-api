import { NextResponse } from "next/server";
import { sessions } from "../sessions";
import { buildPrompt } from "../../../../lib/prompt";
import { loadMasterDcoPrompt } from "../../../../lib/masterDcoPrompt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const sessionId = String(body.sessionId || "");
  const session = sessions.get(sessionId);
  if (!session) return NextResponse.json({ error: "Invalid session" }, { status: 400 });

  session.index += 1;
  // Reset touched categories for the new deal
  session.touched = new Set<string>();
  
  if (session.index >= session.deals.length) {
    return NextResponse.json({ done: true });
  }

  const deal = session.deals[session.index];
  const mp = session.masterPromptText
    ? {
        text: session.masterPromptText,
        sha256: session.masterPromptSha256 || "",
        loadedAt: session.masterPromptLoadedAt || Date.now(),
        sourcePath: session.masterPromptSourcePath || "",
      }
    : await loadMasterDcoPrompt();

  if (!session.masterPromptText) {
    session.masterPromptText = mp.text;
    session.masterPromptSha256 = mp.sha256;
    session.masterPromptLoadedAt = mp.loadedAt;
    session.masterPromptSourcePath = mp.sourcePath;
  }

  const contextBlock = buildPrompt(
    deal,
    session.repName.split(" ")[0] || session.repName,
    session.deals.length,
    false,
    session.touched,
    session.scoreDefs
  );
  const instructions = `${mp.text}\n\n${contextBlock}`;

  return NextResponse.json({ done: false, instructions });
}
