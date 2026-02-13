// Shared sessions storage - persists across hot reloads
// Using a global variable to avoid Next.js module reload issues

declare global {
  // eslint-disable-next-line no-var
  var __sessions__: Map<
    string,
    {
      orgId: number;
      repName: string;
      // Master DCO prompt cached per session
      masterPromptText?: string;
      masterPromptSha256?: string;
      masterPromptLoadedAt?: number;
      masterPromptSourcePath?: string;
      // Category progression tracking (separate from DB saves)
      reviewed: Set<string>;
      lastCategoryKey?: string;
      lastCheckType?: "strong" | "progress";
      skipSaveCategoryKey?: string;
      deals: any[];
      index: number;
      scoreDefs: any[];
      touched: Set<string>;
      // Running Responses API item list (messages + tool calls + tool outputs).
      items: any[];
      // End-of-deal wrap must be saved for current deal before advancing.
      wrapSaved: boolean;
      // Strict Master Prompt enforcement: health score phrase must be spoken exactly before advance.
      wrapExpectedHealthPercent?: number;
      wrapHealthPhraseOk?: boolean;
    }
  > | undefined;
}

// Use existing global or create new Map
const sessions =
  global.__sessions__ ||
  (global.__sessions__ = new Map<
    string,
    {
      orgId: number;
      repName: string;
      masterPromptText?: string;
      masterPromptSha256?: string;
      masterPromptLoadedAt?: number;
      masterPromptSourcePath?: string;
      reviewed: Set<string>;
      lastCategoryKey?: string;
      lastCheckType?: "strong" | "progress";
      skipSaveCategoryKey?: string;
      deals: any[];
      index: number;
      scoreDefs: any[];
      touched: Set<string>;
      items: any[];
      wrapSaved: boolean;
      wrapExpectedHealthPercent?: number;
      wrapHealthPhraseOk?: boolean;
    }
  >());

export { sessions };
