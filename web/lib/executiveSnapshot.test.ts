import test from "node:test";
import assert from "node:assert/strict";
import { preprocessInsights, type DashboardInsight } from "./executiveSnapshot";

function mkInsight(partial: Partial<DashboardInsight> & { widgetId: string; widgetName: string; dashboardType: string; createdAt: any; text: string }): DashboardInsight {
  return {
    widgetId: partial.widgetId,
    widgetName: partial.widgetName,
    dashboardType: partial.dashboardType,
    createdAt: partial.createdAt,
    text: partial.text,
  };
}

test("preprocessInsights removes repeated headings and duplicate paragraphs", () => {
  const insights: DashboardInsight[] = [
    mkInsight({
      widgetId: "w1",
      widgetName: "Hero",
      dashboardType: "executive",
      createdAt: "2026-02-21T10:00:00.000Z",
      text: `
Summary:
- Line A

Extended analysis:
- Line A
- Line B

Executive Summary:
- Line A
      `.trim(),
    }),
  ];

  const r = preprocessInsights(insights, { maxInsights: 20 });
  assert.equal(r.inputCountUsed, 1);
  const t = r.cleanedInsights[0]!.text;
  assert.ok(!/^\s*Summary\s*:?/im.test(t));
  assert.ok(!/^\s*Extended analysis\s*:?/im.test(t));
  assert.ok(!/^\s*Executive Summary\s*:?/im.test(t));
  // "Line A" should not appear 3 times after paragraph dedupe.
  const countLineA = (t.match(/Line A/g) || []).length;
  assert.ok(countLineA <= 2);
});

test("preprocessInsights dedupes near-identical insights and keeps newest", () => {
  const older = mkInsight({
    widgetId: "a",
    widgetName: "Widget A",
    dashboardType: "executive",
    createdAt: "2026-02-20T10:00:00.000Z",
    text: "Summary: Pipeline coverage is strong at 3.5x. Actions: focus on velocity.",
  });
  const newer = mkInsight({
    widgetId: "b",
    widgetName: "Widget B",
    dashboardType: "executive",
    createdAt: "2026-02-21T10:00:00.000Z",
    text: "Executive Summary: Pipeline coverage is strong at 3.6x. Actions: focus on velocity.",
  });

  const r = preprocessInsights([older, newer], { maxInsights: 20 });
  assert.equal(r.inputCountUsed, 1);
  assert.equal(r.cleanedInsights[0]!.widgetId, "b");
});

test("preprocessInsights caps count by recency+uniqueness", () => {
  const insights: DashboardInsight[] = [];
  for (let i = 0; i < 30; i++) {
    const a = String.fromCharCode(97 + (i % 26));
    const b = String.fromCharCode(97 + Math.floor(i / 26));
    const uniq = `topic_${a}${b}`; // letters only (stable under numeric-collapsing)
    insights.push(
      mkInsight({
        widgetId: `w${i}`,
        widgetName: `W${i}`,
        dashboardType: i % 2 ? "executive" : "partner",
        createdAt: Date.now() - i * 1000,
        text: `Insight ${uniq}: partner mix improving; action focus differs for ${uniq}`,
      })
    );
  }
  const r = preprocessInsights(insights, { maxInsights: 20 });
  assert.equal(r.inputCountUsed, 20);
});

