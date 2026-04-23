import crypto from "crypto";

type HubSpotWebhookEvent = {
  portalId?: unknown;
  objectId?: unknown;
  dealId?: unknown;
  objectType?: unknown;
  eventType?: unknown;
  subscriptionType?: unknown;
  changeType?: unknown;
};

function normalizeTimestampMs(timestamp: string): number | null {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

function safeString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asWebhookEvents(body: unknown): HubSpotWebhookEvent[] {
  return Array.isArray(body) ? (body as HubSpotWebhookEvent[]) : [];
}

export function verifyHubSpotWebhookSignature(args: {
  rawBody: string;
  signature: string;
  timestamp: string;
  method: string;
  url: string;
}): boolean {
  try {
    const secret = String(process.env.HUBSPOT_APP_CLIENT_SECRET || "").trim();
    const signature = String(args.signature || "").trim();
    const timestamp = String(args.timestamp || "").trim();
    const method = String(args.method || "").trim().toUpperCase();
    const url = String(args.url || "").trim();
    const rawBody = String(args.rawBody ?? "");

    if (!secret || !signature || !timestamp || !method || !url) return false;

    const timestampMs = normalizeTimestampMs(timestamp);
    if (timestampMs == null) return false;

    const maxAgeMs = 300 * 1000;
    if (Date.now() - timestampMs > maxAgeMs) return false;

    const expected = crypto.createHmac("sha256", secret).update(`${method}${url}${rawBody}${timestamp}`, "utf8").digest();
    const received = Buffer.from(signature, "base64");

    if (received.length !== expected.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch (_error) {
    return false;
  }
}

export function extractPortalId(body: unknown): string | null {
  try {
    const events = asWebhookEvents(body);
    const portalId = safeString(events[0]?.portalId);
    return portalId || null;
  } catch (_error) {
    return null;
  }
}

export function extractDealEvents(body: unknown): Array<{
  portalId: string;
  dealId: string;
  eventType: string;
}> {
  try {
    const events = asWebhookEvents(body);
    return events
      .filter((event) => safeString(event?.objectType).toUpperCase() === "DEAL")
      .map((event) => {
        const portalId = safeString(event?.portalId);
        const dealId = safeString(event?.objectId ?? event?.dealId);
        const eventType = safeString(event?.eventType || event?.subscriptionType || event?.changeType);
        return { portalId, dealId, eventType };
      })
      .filter((event) => event.portalId && event.dealId);
  } catch (_error) {
    return [];
  }
}
