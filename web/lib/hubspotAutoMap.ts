export type AutoMapConfidence = "high" | "medium" | "low" | "none";

export interface AutoMapResult {
  sf_field: string;
  hubspot_property: string | null;
  confidence: AutoMapConfidence;
}

const DEAL_META_FIELDS = ["deal_name", "amount", "close_date", "stage", "owner"] as const;

const HIGH_PROPS: Record<string, string> = {
  deal_name: "dealname",
  amount: "amount",
  close_date: "closedate",
  stage: "dealstage",
  owner: "hubspot_owner_id",
};

function normProp(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function findBestMatch(propertyNames: string[], candidates: string[]): { prop: string | null; confidence: AutoMapConfidence } {
  const set = new Set(propertyNames.map(normProp));
  for (const c of candidates) {
    if (set.has(normProp(c))) return { prop: propertyNames.find((p) => normProp(p) === normProp(c)) || c, confidence: "medium" };
  }
  for (const c of candidates) {
    const n = normProp(c);
    const hit = propertyNames.find((p) => normProp(p).includes(n) || n.includes(normProp(p)));
    if (hit) return { prop: hit, confidence: "low" };
  }
  return { prop: null, confidence: "none" };
}

/**
 * Auto-mapping for HubSpot deal properties → SalesForecast sf_field rows (+ notes_source default).
 * No external dependencies.
 */
export function buildHubSpotAutoMap(propertyNames: string[]): AutoMapResult[] {
  const names = Array.isArray(propertyNames) ? propertyNames.filter((x) => String(x || "").trim()) : [];
  const out: AutoMapResult[] = [];

  for (const sf of DEAL_META_FIELDS) {
    const canonical = HIGH_PROPS[sf];
    const exact = names.find((p) => normProp(p) === normProp(canonical));
    if (exact) {
      out.push({ sf_field: sf, hubspot_property: exact, confidence: "high" });
      continue;
    }
    if (sf === "deal_name") {
      const m = findBestMatch(names, ["dealname", "deal_name", "name", "opportunity_name"]);
      out.push({ sf_field: sf, hubspot_property: m.prop, confidence: m.prop ? m.confidence : "none" });
    } else if (sf === "amount") {
      const m = findBestMatch(names, ["amount", "deal_amount", "hs_acv", "hs_arr", "hs_mrr", "hs_tcv"]);
      out.push({ sf_field: sf, hubspot_property: m.prop, confidence: m.prop ? m.confidence : "none" });
    } else if (sf === "close_date") {
      const m = findBestMatch(names, ["closedate", "close_date", "expected_close_date"]);
      out.push({ sf_field: sf, hubspot_property: m.prop, confidence: m.prop ? m.confidence : "none" });
    } else if (sf === "stage") {
      const m = findBestMatch(names, ["dealstage", "deal_stage", "pipeline_stage"]);
      out.push({ sf_field: sf, hubspot_property: m.prop, confidence: m.prop ? m.confidence : "none" });
    } else if (sf === "owner") {
      const m = findBestMatch(names, ["hubspot_owner_id", "owner", "sales_owner"]);
      out.push({ sf_field: sf, hubspot_property: m.prop, confidence: m.prop ? m.confidence : "none" });
    } else {
      out.push({ sf_field: sf, hubspot_property: null, confidence: "none" });
    }
  }

  out.push({
    sf_field: "notes_source",
    hubspot_property: JSON.stringify({ engagements: true }),
    confidence: "high",
  });

  return out;
}
