import {
  Button,
  Divider,
  Flex,
  Heading,
  Link,
  LoadingSpinner,
  Text,
  Tag,
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

  function handleFullReview() {
    if (!tokens?.review) return;
    const publicId = dealData?.public_id || "";
    actions.navigateToExternalUrl({
      url: `https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/session?token=${encodeURIComponent(tokens.review)}&mode=voice`,
      newTab: true,
    });
  }

  function handleOpenDashboard() {
    if (!tokens?.dashboard) return;
    actions.navigateToExternalUrl({
      url: `https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/dashboard?token=${encodeURIComponent(tokens.dashboard)}`,
      newTab: true,
    });
  }

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

      {/* Header row - Health, Verdict, Confidence */}
      <Flex direction="row" gap="small" wrap="wrap">
        {health != null && (
          <Tag variant={healthVariant(health)}>
            Health {health}%
          </Tag>
        )}
        {verdict && <Tag>AI: {verdict}</Tag>}
        {confidence && (
          <Tag variant={confidenceVariant(confidence)}>
            {confidence.charAt(0).toUpperCase() +
              confidence.slice(1)} Confidence
          </Tag>
        )}
      </Flex>

      {/* Top Risk categories */}
      {topRisk.length > 0 && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>Top Risk</Text>
          <Flex direction="row" gap="extra-small" wrap="wrap">
            {topRisk.map((c) => (
              <Tag key={c.key} variant="error">{c.label}</Tag>
            ))}
          </Flex>
        </Flex>
      )}

      {/* Top Risk Evidence */}
      {topRisk.length > 0 && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>
            Top Risk Evidence
          </Text>
          {topRisk.map((c) => {
            const evidence = dealData?.[`${c.key}_summary`];
            return evidence ? (
              <Text key={c.key} variant="microcopy">
                {c.label}: {evidence}
              </Text>
            ) : null;
          })}
        </Flex>
      )}

      {/* Top Risk Coaching Tips */}
      {topRisk.length > 0 && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>
            Coaching Tips
          </Text>
          {topRisk.map((c) => {
            const tip = dealData?.[`${c.key}_tip`];
            return tip ? (
              <Text key={c.key} variant="microcopy">
                {c.label}: {tip}
              </Text>
            ) : null;
          })}
        </Flex>
      )}

      <Divider />

      {/* Risk Summary */}
      {dealData?.risk_summary && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>Risk Summary</Text>
          <Text>{dealData.risk_summary}</Text>
        </Flex>
      )}

      {/* Next Steps */}
      {dealData?.next_steps && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>Next Steps</Text>
          <Text>{dealData.next_steps}</Text>
        </Flex>
      )}

      <Divider />

      {/* Action buttons */}
      <Flex direction="column" gap="small">
        <Button variant="primary" onClick={handleFullReview}>
          ▶ Start Full Review ↗
        </Button>
        <Link onClick={handleOpenDashboard}>
          Open Dashboard →
        </Link>
      </Flex>

    </Flex>
  );
}

