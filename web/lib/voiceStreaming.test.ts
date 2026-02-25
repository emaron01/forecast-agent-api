import test from "node:test";
import assert from "node:assert/strict";
import {
  extractQuestionFromPartialJson,
  extractActionFromPartialJson,
  getVoiceTuningFlags,
  passesEarlyEmitGate,
} from "./voiceStreaming";

test("question with escaped quotes", () => {
  const buf = '{"action":"followup","question":"He said \\"yes\\"?"}';
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(q, 'He said "yes"?');
});

test("question with backslash path", () => {
  const buf = '{"question":"path C:\\\\Temp\\\\file?"}';
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(q, "path C:\\Temp\\file?");
});

test("question with unicode smart quote", () => {
  const buf = '{"question":"What\\u2019s the problem?"}';
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(q, "What\u2019s the problem?");
});

test("action arrives before question", () => {
  const buf = '{"action":"followup","question":"What is X?"}';
  const action = extractActionFromPartialJson(buf);
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(action, "followup");
  assert.strictEqual(q, "What is X?");
});

test("question arrives before action (partial)", () => {
  const buf = '{"question":"What is X?"}';
  const action = extractActionFromPartialJson(buf);
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(action, null);
  assert.strictEqual(q, "What is X?");
});

test("partial JSON - question complete before action (extraction path)", () => {
  const buf = '{"question":"What is the specific business problem?"}';
  const q = extractQuestionFromPartialJson(buf);
  assert.strictEqual(q, "What is the specific business problem?");
});

test("action finalize - no early emit when require_action_followup", () => {
  const buf = '{"action":"finalize","material_change":true}';
  const action = extractActionFromPartialJson(buf);
  assert.strictEqual(action, "finalize");
});

test("output without ending punctuation - passes gate when requireEndPunct false", () => {
  const q = "What is the specific business problem";
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: false }), true);
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: true }), false);
});

test("output with ending punctuation - passes gate", () => {
  const q = "What is the specific business problem?";
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: false }), true);
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: true }), true);
});

test("interrogative start without question mark passes", () => {
  const q = "What is the specific business problem";
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: false }), true);
});

test("garbage short string fails gate", () => {
  const q = "x";
  assert.strictEqual(passesEarlyEmitGate(q, { requireEndPunct: false }), false);
});

test("tuning flags default values", () => {
  const orig = process.env;
  process.env = { ...orig };
  delete process.env.VOICE_MIN_QUESTION_CHARS;
  delete process.env.VOICE_REQUIRE_END_PUNCT;
  delete process.env.VOICE_REQUIRE_ACTION_FOLLOWUP;
  const flags = getVoiceTuningFlags();
  assert.strictEqual(flags.minQuestionChars, 25);
  assert.strictEqual(flags.requireEndPunct, false);
  assert.strictEqual(flags.requireActionFollowup, true);
  process.env = orig;
});

test("tuning flags custom values", () => {
  const orig = process.env;
  process.env = {
    ...orig,
    VOICE_MIN_QUESTION_CHARS: "40",
    VOICE_REQUIRE_END_PUNCT: "true",
    VOICE_REQUIRE_ACTION_FOLLOWUP: "false",
  };
  const flags = getVoiceTuningFlags();
  assert.strictEqual(flags.minQuestionChars, 40);
  assert.strictEqual(flags.requireEndPunct, true);
  assert.strictEqual(flags.requireActionFollowup, false);
  process.env = orig;
});
