import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/pool";
import { getIngestQueue, QUEUE_NAME } from "../../../../../lib/ingest-queue";
import { verifyWebhookSignature } from "../../../../../lib/hubspotClient";
import { getHubspotScoringCloseDateBounds } from "../../../../../lib/hubspotIngest";

export const runtime = "nodejs";

/**
 * HubSpot v3 signs `method + url + body + timestamp` where `url` must match the webhook URL
 * registered in the app (public origin + pathname + query), byte-for-byte.
 *
 * On Render, `req.url` is often relative (`/api/...`) or an internal absolute URL. We must
 * always rebuild the public origin from `x-forwarded-proto` + `x-forwarded-host` (first hop)
 * and take **pathname + search** only from `req.url` — never trust the host inside `req.url`
 * when forward headers are present, or v3 verification will always fail.
 */
function pathnameAndSearchFromReqUrl(reqUrl: string): string {
  const raw = String(reqUrl || "").trim();
  if (!raw) return "/";
  try {
    const u = new URL(raw);
    return u.pathname + u.search;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

function normalizeHostDefaultPorts(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.endsWith(":443")) return h.slice(0, -4);
  if (h.endsWith(":80")) return h.slice(0, -3);
  return h;
}

function requestFullUrl(req: Request): string {
  const pathSearch = pathnameAndSearchFromReqUrl(req.url);
  const qIdx = pathSearch.indexOf("?");
  const rawPath = qIdx === -1 ? pathSearch : pathSearch.slice(0, qIdx);
  const search = qIdx === -1 ? "" : pathSearch.slice(qIdx);
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;

  const forwardedHostRaw = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const forwardedProtoRaw = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  const proto =
    forwardedProtoRaw === "http" || forwardedProtoRaw === "https" ? forwardedProtoRaw : "https";

  if (forwardedHostRaw) {
    const host = normalizeHostDefaultPorts(forwardedHostRaw);
    return `${proto}://${host}${path}${search}`;
  }

  try {
    const u = new URL(req.url);
    if (u.host) {
      const p = u.protocol === "http:" || u.protocol === "https:" ? u.protocol.replace(":", "") : "https";
      const host = normalizeHostDefaultPorts(u.host);
      return `${p}://${host}${path}${search}`;
    }
  } catch {
    /* ignore */
  }

  const hostHeader = (req.headers.get("host") || "").split(",")[0].trim();
  if (!hostHeader) return "";
  const host = normalizeHostDefaultPorts(hostHeader);
  return `${proto}://${host}${path}${search}`;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const clientSecret = String(process.env.HUBSPOT_CLIENT_SECRET || "").trim();
  const versionRaw = String(
    req.headers.get("x-hubspot-signature-version") || req.headers.get("X-HubSpot-Signature-Version") || ""
  ).trim();
  const versionNorm = versionRaw.toLowerCase();
  const isV3 = versionNorm === "v3" || versionNorm === "3";
  const signature = isV3
    ? String(req.headers.get("x-hubspot-signature-v3") || req.headers.get("X-HubSpot-Signature-v3") || "").trim()
    : String(req.headers.get("x-hubspot-signature") || req.headers.get("X-HubSpot-Signature") || "").trim();
  const timestamp = String(req.headers.get("x-hubspot-request-timestamp") || req.headers.get("X-HubSpot-Request-Timestamp") || "").trim();

  const ok = verifyWebhookSignature({
    clientSecret,
    method: req.method || "POST",
    url: requestFullUrl(req),
    body: rawBody,
    signature,
    signatureVersion: versionRaw,
    ...(isV3 ? { timestamp } : {}),
  });

  if (!ok) {
    return new NextResponse(null, { status: 401 });
  }

  let events: any[] = [];
  try {
    const parsed = JSON.parse(rawBody || "[]");
    events = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    events = [];
  }

  const queue = getIngestQueue();

  for (const ev of events) {
    const sub = String(ev?.subscriptionType || ev?.changeType || "").trim();
    const portalId = String(ev?.portalId ?? ev?.hubId ?? "").trim();
    const objectId = String(ev?.objectId ?? ev?.dealId ?? "").trim();
    if (!portalId || !objectId) continue;

    const { rows } = await pool.query<{ org_id: string }>(
      `SELECT org_id::text AS org_id FROM hubspot_connections WHERE hub_id = $1 LIMIT 1`,
      [portalId]
    );
    const orgId = Number(rows?.[0]?.org_id || 0);
    if (!orgId) continue;

    if (!queue || QUEUE_NAME !== "opportunity-ingest") continue;

    if (sub === "deal.deletion" || sub === "deal.deleted") {
      try {
        await queue.add(
          "hubspot-deal-delete",
          { orgId, dealId: objectId },
          { jobId: `hubspot-deal-delete_${orgId}_${objectId}_${Date.now()}`, removeOnComplete: true, removeOnFail: false }
        );
      } catch {
        /* ignore */
      }
      continue;
    }

    if (sub === "deal.creation" || sub === "deal.propertyChange") {
      if (sub === "deal.creation") {
        const { after, before } = getHubspotScoringCloseDateBounds();
        const props = ev?.properties || {};
        const closeRaw = props?.closedate ?? props?.hs_closedate;
        if (closeRaw) {
          const cd = new Date(String(closeRaw));
          if (
            Number.isFinite(cd.getTime()) &&
            (cd.getTime() < after.getTime() || cd.getTime() >= before.getTime())
          ) {
            continue;
          }
        }
      }
      try {
        await queue.add(
          "hubspot-deal-update",
          { orgId, dealId: objectId },
          { jobId: `hubspot-deal-update_${orgId}_${objectId}_${Date.now()}`, removeOnComplete: true, removeOnFail: false }
        );
      } catch {
        /* ignore */
      }
    }
  }

  return NextResponse.json({ ok: true });
}
