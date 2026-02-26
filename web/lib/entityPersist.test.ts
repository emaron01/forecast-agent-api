/**
 * Unit tests for entity persist merge rules (don't overwrite existing with empty; quality comparison).
 * Helpers live in muscle.js and are exported for testing.
 */
// @ts-expect-error root ESM
import { isBetterName, isBetterTitle, mergeEntityValue } from "../../muscle.js";
import test from "node:test";
import assert from "node:assert/strict";

test("mergeEntityValue: do not overwrite existing with empty", () => {
  assert.strictEqual(mergeEntityValue("champion_name", "Jane Doe", ""), null);
  assert.strictEqual(mergeEntityValue("champion_name", "Jane Doe", null), null);
  assert.strictEqual(mergeEntityValue("eb_title", "Director", "  "), null);
});

test("mergeEntityValue: use incoming when existing is empty (including generic titles)", () => {
  assert.strictEqual(mergeEntityValue("champion_name", null, "Jane Doe"), "Jane Doe");
  assert.strictEqual(mergeEntityValue("champion_name", "", "Jane Doe"), "Jane Doe");
  assert.strictEqual(mergeEntityValue("eb_title", null, "VP Engineering"), "VP Engineering");
  assert.strictEqual(mergeEntityValue("eb_title", "", "CFO"), "CFO");
  assert.strictEqual(mergeEntityValue("champion_title", null, "VP"), "VP");
});

test("mergeEntityValue: full name (>=2 words) beats single word", () => {
  assert.strictEqual(mergeEntityValue("eb_name", "Jane", "Jane Doe"), "Jane Doe");
  assert.strictEqual(mergeEntityValue("champion_name", "Bob", "Bob Smith"), "Bob Smith");
  assert.strictEqual(mergeEntityValue("eb_name", "Jane Doe", "Jane"), null);
});

test("mergeEntityValue: specific title beats generic", () => {
  assert.strictEqual(mergeEntityValue("champion_title", "VP", "VP of Engineering"), "VP of Engineering");
  assert.strictEqual(mergeEntityValue("eb_title", "Lead", "Engineering Director"), "Engineering Director");
});

test("isBetterName: full name > single word", () => {
  assert.strictEqual(isBetterName("", "Jane Doe"), true);
  assert.strictEqual(isBetterName("Jane", "Jane Doe"), true);
  assert.strictEqual(isBetterName("Jane Doe", "Jane"), false);
  assert.strictEqual(isBetterName("Jane Doe", "Bob Smith"), false);
});

test("isBetterTitle: specific/longer beats generic", () => {
  assert.strictEqual(isBetterTitle("", "Director"), true);
  assert.strictEqual(isBetterTitle("VP", "VP of Engineering"), true);
  assert.strictEqual(isBetterTitle("Director", "VP"), false);
});
