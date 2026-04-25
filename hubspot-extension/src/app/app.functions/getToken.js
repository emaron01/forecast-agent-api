const crypto = require("crypto");

exports.main = async ({ parameters, secrets }) => {
  const { dealId, userEmail, portalId } = parameters;

  if (!dealId || !userEmail || !portalId) {
    throw new Error("Missing required parameters");
  }

  const appUrl = String(secrets.APP_URL || "").trim()
    .replace(/\/+$/, "");
  const clientSecret = String(
    secrets.HUBSPOT_CLIENT_SECRET || "").trim();

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

  const res = await fetch(
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

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(
      `Token endpoint returned non-JSON (status ${res.status})`
    );
  }

  if (!res.ok || !json.ok) {
    throw new Error(
      json?.error || `Token request failed (${res.status})`
    );
  }

  return {
    ok: true,
    reviewToken: json.reviewToken,
    dashboardToken: json.dashboardToken,
    dealState: json.dealState,
  };
};

