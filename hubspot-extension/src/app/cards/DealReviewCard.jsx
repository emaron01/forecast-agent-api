import {
  Button,
  Divider,
  Flex,
  Heading,
  Link,
  LoadingSpinner,
  Text,
  Tag,
  Accordion,
} from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { useState, useEffect } from "react";

// APP_URL is injected from serverless secrets at runtime
// Do not hardcode any URL here

hubspot.extend(({ context, actions }) => (
  <DealReviewCard context={context} actions={actions} />
));

function DealReviewCard({ context, actions }) {
  const [state, setState] = useState("loading");
  const [dealData, setDealData] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function init() {
      try {
        const response = await hubspot.fetch(
          "https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/token",
          {
            method: "POST",
            body: {
              portalId: String(context.portal.id),
              dealId: String(context.crm.objectId),
              userEmail: String(context.user.email),
            },
          }
        );

        const result = await response.json();
        if (!result.ok) throw new Error(result.error || "Token fetch failed");
        setDealData(result.dealState);
        setTokens({
          review: result.reviewToken,
          dashboard: result.dashboardToken,
          publicId: result.dealState?.public_id || "",
        });
        setState("ready");
      } catch (e) {
        setError(String(e?.message || "Failed to load"));
        setState("error");
      }
    }
    init();
  }, []);

  if (state === "loading") {
    return (
      <Flex direction="column" align="center"
        justify="center">
        <LoadingSpinner />
        <Text>Loading deal data...</Text>
      </Flex>
    );
  }

  if (state === "error") {
    return (
      <Flex direction="column" gap="small">
        <Text format={{ color: "alert" }}>
          {error || "Unable to load deal data"}
        </Text>
        <Text variant="microcopy">
          Check that this HubSpot portal is connected
          to SalesForecast.io and try again.
        </Text>
      </Flex>
    );
  }

  const health = dealData?.health_pct ?? null;
  const confidence = dealData?.confidence_band ?? null;
  const verdict = dealData?.ai_verdict ?? null;

  const CATEGORY_KEYS = [
    { key: "pain", label: "Pain" },
    { key: "metrics", label: "Metrics" },
    { key: "champion", label: "Champion" },
    { key: "eb", label: "EB" },
    { key: "criteria", label: "Criteria" },
    { key: "process", label: "Process" },
    { key: "competition", label: "Competition" },
    { key: "paper", label: "Paper" },
    { key: "timing", label: "Timing" },
    { key: "budget", label: "Budget" },
  ];

  const topRisk = CATEGORY_KEYS.filter((c) => {
    const score = dealData?.[`${c.key}_score`];
    return score == null || Number(score) <= 1;
  }).slice(0, 4);

  function healthVariant(pct) {
    if (pct == null) return "default";
    if (pct >= 70) return "success";
    if (pct >= 40) return "warning";
    return "error";
  }

  function confidenceVariant(band) {
    if (band === "high") return "success";
    if (band === "medium") return "warning";
    return "error";
  }

  return (
    <Flex direction="column" gap="medium">

      {/* TOP SECTION */}
      <Heading>SalesForecast.io</Heading>

      {/* Pills row 1: Initial Health, Health, Evidence, AI Forecast */}
      <Flex direction="row" gap="small" wrap="wrap">
        {dealData?.baseline_health_score != null && (
          <Tag variant={healthVariant(
            Math.round((Number(dealData.baseline_health_score) / 30) * 100)
          )}>
            Initial {Math.round((Number(dealData.baseline_health_score) / 30) * 100)}%
          </Tag>
        )}
        {health != null && (
          <Tag variant={healthVariant(health)}>
            Health {health}%
          </Tag>
        )}
        {confidence && (
          <Tag variant={confidenceVariant(confidence)}>
            {confidence.charAt(0).toUpperCase() +
              confidence.slice(1)}
          </Tag>
        )}
        {verdict && (
          <Tag variant={
            verdict.toLowerCase() === "commit" ? "success" :
            verdict.toLowerCase() === "best case" ? "warning" :
            "default"
          }>
            AI: {verdict}
          </Tag>
        )}
      </Flex>

      {/* MEDDPICC+TB pills color coded by score */}
      <Flex direction="row" gap="extra-small" wrap="wrap">
        {CATEGORY_KEYS.map((c) => {
          const score = Number(dealData?.[`${c.key}_score`] ?? 0);
          const variant =
            score >= 3 ? "success" :
            score >= 2 ? "warning" :
            "error";
          return (
            <Tag key={c.key} variant={variant}>
              {c.label}
            </Tag>
          );
        })}
      </Flex>

      {/* Manager Request for Matthew Review */}
      <Button
        variant="secondary"
        onClick={() => {
          if (!dealData?.public_id) return;
          actions.navigateToExternalUrl({
            url: `https://forecast-agent-api.onrender.com/opportunities/${dealData.public_id}/deal-review?requestReview=true`,
            newTab: true,
          });
        }}
      >
        Request Matthew Review
      </Button>

      <Divider />

      {/* Start Full Review button */}
      <Link href={`https://forecast-agent-api.onrender.com/opportunities/${dealData?.public_id || ""}/deal-review`}>
        ▶ Start Full Review ↗
      </Link>

      <Divider />

      {/* MEDDPICC+TB ACCORDION SECTION */}
      {CATEGORY_KEYS.map((c) => {
        const score = Number(dealData?.[`${c.key}_score`] ?? 0);
        const evidence = dealData?.[`${c.key}_summary`];
        const tip = dealData?.[`${c.key}_tip`];
        const scoreVariant =
          score >= 3 ? "success" :
          score >= 2 ? "warning" :
          "error";
        return (
          <Accordion
            key={c.key}
            title={
              <Flex direction="row" gap="small"
                align="center">
                <Text format={{ fontWeight: "bold" }}>
                  {c.label}
                </Text>
                <Tag variant={scoreVariant}>
                  {score}/3
                </Tag>
              </Flex>
            }
          >
            <Flex direction="column" gap="extra-small">
              {evidence && (
                <Text variant="microcopy">
                  Evidence: {evidence}
                </Text>
              )}
              {tip && score < 3 && (
                <Text variant="microcopy"
                  format={{ color: "alert" }}>
                  Tip: {tip}
                </Text>
              )}
              {!evidence && !tip && (
                <Text variant="microcopy">
                  No data yet — complete a Matthew review
                  to populate this category.
                </Text>
              )}
            </Flex>
          </Accordion>
        );
      })}

      <Divider />

      {/* RISK SUMMARY + NEXT STEPS ACCORDION */}
      <Accordion title="Risk Summary & Next Steps">
        <Flex direction="column" gap="small">
          {dealData?.risk_summary && (
            <Flex direction="column" gap="extra-small">
              <Text format={{ fontWeight: "bold" }}>
                Risk Summary
              </Text>
              <Text>{dealData.risk_summary}</Text>
            </Flex>
          )}
          {dealData?.next_steps && (
            <Flex direction="column" gap="extra-small">
              <Text format={{ fontWeight: "bold" }}>
                Next Steps
              </Text>
              <Text>{dealData.next_steps}</Text>
            </Flex>
          )}
          {!dealData?.risk_summary && !dealData?.next_steps && (
            <Text variant="microcopy">
              No risk summary yet — complete a Matthew
              review to generate one.
            </Text>
          )}
        </Flex>
      </Accordion>

      <Divider />

      {/* Open Dashboard */}
      <Link href={`https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/dashboard?token=${encodeURIComponent(tokens?.dashboard || "")}`}>
        Open Dashboard →
      </Link>

    </Flex>
  );
}

