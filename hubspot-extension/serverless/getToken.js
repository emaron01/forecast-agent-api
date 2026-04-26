const crypto = require("crypto");

exports.main = async (context) => {
  const { dealId, userEmail, portalId } = context.parameters;

  if (!dealId || !userEmail || !portalId) {
    throw new Error("Missing required parameters");
  }

  const appUrl = process.env.APP_URL || "";
  const clientSecret = process.env.HUBSPOT_EXTENSION_CLIENT_SECRET || "";

  if (!appUrl || !clientSecret) {
    throw new Error("Server secrets not configured");
  }

  const timestamp = String(Date.now());

  const body = JSON.stringify({
    portalId,
    dealId,
    userEmail,
    timestamp,
  });

  const signature = crypto
    .createHash("sha256")
    .update(clientSecret + timestamp + body)
    .digest("hex");

  const response = await fetch(
    `${appUrl}/api/crm/hubspot/extension/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HubSpot-Signature": signature,
        "X-HubSpot-Request-Timestamp": timestamp,
      },
      body,
    }
  );

  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json?.error || `Token request failed (${response.status})`);
  }

  return {
    ok: true,
    reviewToken: json.reviewToken,
    dashboardToken: json.dashboardToken,
    dealState: json.dealState,
  };
};

