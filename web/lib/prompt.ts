type Deal = Record<string, any>;
type ScoreDef = { category: string; score: number; label?: string; criteria?: string };

function formatScoreDefinitions(defs: ScoreDef[]) {
  if (!Array.isArray(defs) || defs.length === 0) return "No criteria available.";
  const byCat = new Map<string, ScoreDef[]>();
  for (const row of defs) {
    const cat = row.category || "unknown";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(row);
  }
  const lines: string[] = [];
  for (const [cat, rows] of byCat.entries()) {
    rows.sort((a, b) => Number(a.score) - Number(b.score));
    lines.push(`${cat.toUpperCase()}:`);
    for (const r of rows) {
      lines.push(`- ${r.score}: ${r.label || ""} — ${r.criteria || ""}`);
    }
  }
  return lines.join("\n");
}

function buildLabelMap(defs: ScoreDef[]) {
  const map: Record<string, Record<number, string>> = {};
  for (const row of defs || []) {
    const cat = row.category;
    if (!cat) continue;
    if (!map[cat]) map[cat] = {};
    map[cat][Number(row.score)] = row.label || "";
  }
  return map;
}

function computeFirstGap(deal: Deal, stage: string, touchedSet?: Set<string>) {
  const stageStr = String(stage || deal?.forecast_stage || "Pipeline");
  const pipelineOrder = [
    { name: "Pain", key: "pain_score", val: deal.pain_score, touchedKey: "pain" },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score, touchedKey: "metrics" },
    { name: "Champion", key: "champion_score", val: deal.champion_score, touchedKey: "champion" },
    { name: "Competition", key: "competition_score", val: deal.competition_score, touchedKey: "competition" },
    { name: "Budget", key: "budget_score", val: deal.budget_score, touchedKey: "budget" },
  ];
  const bestCaseCommitOrder = [
    { name: "Pain", key: "pain_score", val: deal.pain_score, touchedKey: "pain" },
    { name: "Metrics", key: "metrics_score", val: deal.metrics_score, touchedKey: "metrics" },
    { name: "Champion", key: "champion_score", val: deal.champion_score, touchedKey: "champion" },
    { name: "Criteria", key: "criteria_score", val: deal.criteria_score, touchedKey: "criteria" },
    { name: "Competition", key: "competition_score", val: deal.competition_score, touchedKey: "competition" },
    { name: "Timing", key: "timing_score", val: deal.timing_score, touchedKey: "timing" },
    { name: "Budget", key: "budget_score", val: deal.budget_score, touchedKey: "budget" },
    { name: "Economic Buyer", key: "eb_score", val: deal.eb_score, touchedKey: "eb" },
    { name: "Decision Process", key: "process_score", val: deal.process_score, touchedKey: "process" },
    { name: "Paper Process", key: "paper_score", val: deal.paper_score, touchedKey: "paper" },
  ];
  const order = stageStr.includes("Commit") || stageStr.includes("Best Case")
    ? bestCaseCommitOrder
    : pipelineOrder;

  if (touchedSet && touchedSet.size > 0) {
    const nextUntouched = order.find((s) => !touchedSet.has(s.touchedKey));
    if (nextUntouched) return nextUntouched;
  }
  return order[0];
}

export function buildPrompt(deal: Deal, repName: string, totalCount: number, isFirstDeal: boolean, touchedSet: Set<string>, scoreDefs: ScoreDef[]) {
  const stage = deal.forecast_stage || "Pipeline";
  const amountStr = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(deal.amount || 0));
  const closeDateStr = deal.close_date ? new Date(deal.close_date).toLocaleDateString() : "TBD";
  const oppName = (deal.opportunity_name || "").trim();
  const oppNamePart = oppName ? ` — ${oppName}` : "";

  const callPickup =
    `Hi ${repName}, this is Matthew from Sales Forecaster. ` +
    `Today we are reviewing ${totalCount} deals. ` +
    `Let's jump in starting with ${deal.account_name}${oppNamePart} ` +
    `for ${amountStr} in CRM Forecast Stage ${stage} closing ${closeDateStr}.`;

  const dealOpening =
    `Let’s look at ${deal.account_name}${oppNamePart}, ` +
    `${stage}, ${amountStr}, closing ${closeDateStr}.`;

  const riskRecall = deal.risk_summary
    ? `Existing Risk Summary: ${deal.risk_summary}`
    : "No prior risk summary recorded.";

  const firstGap = computeFirstGap(deal, stage, touchedSet);
  const labelMap = buildLabelMap(scoreDefs);
  const labelKeyMap: Record<string, string> = {
    pain_score: "pain",
    metrics_score: "metrics",
    champion_score: "champion",
    criteria_score: "criteria",
    competition_score: "competition",
    timing_score: "timing",
    budget_score: "budget",
    eb_score: "economic_buyer",
    process_score: "process",
    paper_score: "paper",
  };
  const scoreVal = Number(deal?.[firstGap.key] ?? 0);
  const labelCategory = labelKeyMap[firstGap.key] || "";
  const label = (labelCategory && labelMap[labelCategory]?.[scoreVal]) || "Unknown";

  const gapQuestion = (() => {
    if (scoreVal >= 3) {
      return `Last review ${firstGap.name} was strong.\nHas anything changed that could introduce new risk?`;
    }
    if (scoreVal === 0) {
      if (String(stage).includes("Pipeline")) {
        if (firstGap.name === "Pain")
          return "What specific business problem is the customer trying to solve, and what happens if they do nothing?";
        if (firstGap.name === "Metrics")
          return "What measurable outcome has the customer agreed matters, and who validated it?";
        if (firstGap.name === "Champion")
          return "Who is driving this internally, what is their role, and how have they shown advocacy?";
        if (firstGap.name === "Budget")
          return "Has budget been discussed or confirmed, and at what level?";
        return `What changed since last time on ${firstGap.name}?`;
      }
      return `What is the latest on ${firstGap.name}?`;
    }
    return `Last review ${firstGap.name} was ${label}.\nHave we made progress since the last review?`;
  })();

  const firstLine = isFirstDeal ? callPickup : dealOpening;
  const criteriaBlock = formatScoreDefinitions(scoreDefs);

  return [
    "DEAL CONTEXT (data)",
    `DEAL_ID: ${deal.id}`,
    `ACCOUNT_NAME: ${deal.account_name}`,
    `OPPORTUNITY_NAME: ${oppName || "(none)"}`,
    `STAGE: ${stage}`,
    `AMOUNT: ${amountStr}`,
    `CLOSE_DATE: ${closeDateStr}`,
    "",
    "SPOKEN DEAL OPENER (exact):",
    firstLine,
    "",
    "SPOKEN RISK SUMMARY (exact):",
    riskRecall,
    "",
    "NEXT QUESTION (ask now):",
    gapQuestion,
    "",
    "SCORING CRITERIA (AUTHORITATIVE)",
    criteriaBlock,
  ].join("\n");
}

export function buildNoDealsPrompt(repName: string, reason?: string) {
  const rep = String(repName || "Rep").trim() || "Rep";
  const why = String(reason || "").trim();
  const reasonLine = why ? `Reason: ${why}` : "Reason: No deals were found for this rep.";

  return [
    "NO-DEALS CONTEXT (data)",
    reasonLine,
    "",
    `Rep: ${rep}`,
    "",
    "To begin the workflow, collect the following deal header fields:",
    "- account name",
    "- opportunity name (optional)",
    "- forecast stage",
    "- amount",
    "- close date",
  ].join("\n");
}
