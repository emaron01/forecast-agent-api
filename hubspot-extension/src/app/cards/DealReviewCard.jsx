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
  Alert,
} from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { useState, useEffect, useCallback } from "react";

hubspot.extend(({ context, actions }) => (
  <DealReviewCard context={context} actions={actions} />
));

function DealReviewCard({ context, actions }) {
  const [state, setState] = useState("loading");
  const [dealData, setDealData] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setState("loading");
    }
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
      });
      setState("ready");
    } catch (e) {
      setError(String(e?.message || "Failed to load"));
      setState("error");
    } finally {
      setRefreshing(false);
    }
  }, [context.portal.id, context.crm.objectId, context.user.email]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  if (state === "loading") {
    return (
      <Flex direction="column" align="center" justify="center">
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
          Check that this HubSpot portal is connected to SalesForecast.io and try again.
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

  function parseSummary(summary) {
    if (!summary) return { label: null, evidence: null };
    const colonIdx = summary.indexOf(":");
    if (colonIdx === -1) return { label: null, evidence: summary.trim() };
    return {
      label: summary.slice(0, colonIdx).trim(),
      evidence: summary.slice(colonIdx + 1).trim(),
    };
  }

  function labelVariant(score) {
    if (score >= 3) return "success";
    if (score >= 2) return "warning";
    return "error";
  }

  const reviewUrl = tokens?.review
    ? `https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/session?token=${encodeURIComponent(tokens.review)}&mode=voice`
    : "";

  const dashboardUrl = tokens?.dashboard
    ? `https://forecast-agent-api.onrender.com/api/crm/hubspot/extension/dashboard?token=${encodeURIComponent(tokens.dashboard)}`
    : "";

  return (
    <Flex direction="column" gap="medium">

      {/* Header row with refresh button */}
      <Flex direction="row" justify="between" align="center">
        <Heading>SalesForecast.io</Heading>
        <Button
          variant="transparent"
          size="xs"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </Flex>

      {/* Health + AI pills */}
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
            {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
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
          return (
            <Tag key={c.key} variant={labelVariant(score)}>
              {c.label}
            </Tag>
          );
        })}
      </Flex>

      {/* Manager review request note */}
      {dealData?.review_request_note && (
        <Alert title="Matthew Review Requested" variant="warning">
          <Flex direction="column" gap="extra-small">
            <Text>
              {dealData.review_requested_by_name
                ? `${dealData.review_requested_by_name} has requested a Matthew review.`
                : "A Matthew review has been requested."}
            </Text>
            <Text format={{ fontWeight: "bold" }}>
              Manager note: "{dealData.review_request_note}"
            </Text>
          </Flex>
        </Alert>
      )}

      <Divider />

      {/* Both links on same row */}
      <Flex direction="row" gap="medium">
        {reviewUrl ? (
          <Link href={reviewUrl}>Start SalesForecast.io Review</Link>
        ) : null}
        {dashboardUrl ? (
          <Link href={dashboardUrl}>Open Dashboard</Link>
        ) : null}
      </Flex>

      <Divider />

      {/* MEDDPICC+TB single accordion */}
      <Accordion title="MEDDPICC+TB Evidence & Coaching">
        <Flex direction="column" gap="medium">
          {CATEGORY_KEYS.map((c) => {
            const score = Number(dealData?.[`${c.key}_score`] ?? 0);
            const rawSummary = dealData?.[`${c.key}_summary`];
            const tip = dealData?.[`${c.key}_tip`];
            const { label, evidence } = parseSummary(rawSummary);
            const displayLabel = label || (
              score >= 3 ? "Verified" :
              score >= 2 ? "Credible" :
              score >= 1 ? "Vague" :
              "Unknown"
            );

            return (
              <Flex key={c.key} direction="column" gap="extra-small">
                <Flex direction="row" gap="small" align="center">
                  <Text format={{ fontWeight: "bold" }}>{c.label}</Text>
                  <Tag variant={labelVariant(score)}>{displayLabel}</Tag>
                </Flex>
                {evidence ? (
                  <Flex direction="row" gap="extra-small">
                    <Text format={{ fontWeight: "bold" }}>Evidence:</Text>
                    <Text variant="microcopy">{evidence}</Text>
                  </Flex>
                ) : null}
                {tip && score < 3 ? (
                  <Flex direction="row" gap="extra-small">
                    <Text format={{ fontWeight: "bold" }}>Tip:</Text>
                    <Text variant="microcopy">{tip}</Text>
                  </Flex>
                ) : null}
                {!evidence && !tip ? (
                  <Text variant="microcopy">
                    No data yet - complete a Matthew review to populate this category.
                  </Text>
                ) : null}
              </Flex>
            );
          })}
        </Flex>
      </Accordion>

      <Divider />

      {/* Risk Summary + Next Steps accordion */}
      <Accordion title="Risk Summary & Next Steps">
        <Flex direction="column" gap="small">
          {dealData?.risk_summary ? (
            <Flex direction="column" gap="extra-small">
              <Text format={{ fontWeight: "bold" }}>Risk Summary</Text>
              <Text>{dealData.risk_summary}</Text>
            </Flex>
          ) : null}
          {dealData?.next_steps ? (
            <Flex direction="column" gap="extra-small">
              <Text format={{ fontWeight: "bold" }}>Next Steps</Text>
              <Text>{dealData.next_steps}</Text>
            </Flex>
          ) : null}
          {!dealData?.risk_summary && !dealData?.next_steps ? (
            <Text variant="microcopy">
              No risk summary yet - complete a Matthew review to generate one.
            </Text>
          ) : null}
        </Flex>
      </Accordion>

    </Flex>
  );
}
