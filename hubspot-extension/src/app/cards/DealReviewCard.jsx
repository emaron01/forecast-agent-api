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

hubspot.extend(({ context, runServerlessFunction, actions }) => (
  <DealReviewCard
    context={context}
    runServerlessFunction={runServerlessFunction}
    actions={actions}
  />
));

function DealReviewCard({ context, runServerlessFunction, actions }) {
  const [state, setState] = useState("loading");
  const [dealData, setDealData] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function init() {
      try {
        const result = await runServerlessFunction({
          name: "getToken",
          parameters: {
            dealId: String(context.crm.objectId),
            userEmail: String(context.user.email),
            portalId: String(context.portal.id),
          },
        });
        if (!result.ok) throw new Error(result.error);
        setDealData(result.dealState);
        setTokens({
          review: result.reviewToken,
          dashboard: result.dashboardToken,
        });
        setState("ready");
      } catch (e) {
        setError(String(e?.message || "Failed to load"));
        setState("error");
      }
    }
    init();
  }, []);

  function handleStartReview(mode) {
    if (!tokens?.review) return;
    actions.openIframeModal({
      uri: `${context.portal.appUrl ||
        "https://app.salesforecast.io"
      }/crm/hubspot/review?token=${
        encodeURIComponent(tokens.review)
      }&mode=${mode}`,
      height: 900,
      width: 1200,
      title: "SalesForecast.io Deal Review",
      flush: true,
    });
  }

  function handleOpenDashboard() {
    if (!tokens?.dashboard) return;
    actions.openIframeModal({
      uri: `${context.portal.appUrl ||
        "https://app.salesforecast.io"
      }/api/crm/hubspot/extension/dashboard?token=${
        encodeURIComponent(tokens.dashboard)
      }`,
      height: 900,
      width: 1400,
      title: "SalesForecast.io Dashboard",
      flush: true,
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
      <Heading>SalesForecast.io</Heading>

      {/* Health + Verdict + Confidence pills */}
      <Flex direction="row" gap="small" wrap="wrap">
        {health != null && (
          <Tag variant={healthVariant(health)}>
            Health {health}%
          </Tag>
        )}
        {verdict && (
          <Tag>AI: {verdict}</Tag>
        )}
        {confidence && (
          <Tag variant={confidenceVariant(confidence)}>
            {confidence.charAt(0).toUpperCase() +
              confidence.slice(1)} Confidence
          </Tag>
        )}
      </Flex>

      {/* Top Risk */}
      {topRisk.length > 0 && (
        <Flex direction="column" gap="extra-small">
          <Text format={{ fontWeight: "bold" }}>
            Top Risk
          </Text>
          <Flex direction="row" gap="extra-small"
            wrap="wrap">
            {topRisk.map((c) => (
              <Tag key={c.key} variant="error">
                {c.label}
              </Tag>
            ))}
          </Flex>
        </Flex>
      )}

      <Divider />

      {/* Action buttons */}
      <Flex direction="column" gap="small">
        <Button
          variant="primary"
          onClick={() => handleStartReview("voice")}
        >
          ▶ Start Voice Review
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleStartReview("text")}
        >
          ✎ Text Update
        </Button>
      </Flex>

      <Divider />

      <Link onClick={handleOpenDashboard}>
        Open Full Dashboard →
      </Link>
    </Flex>
  );
}

