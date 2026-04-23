import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/pool";
import { getIngestQueue, QUEUE_NAME } from "../../../../../lib/ingest-queue";
import {
  extractDealEvents,
  extractPortalId,
  verifyHubSpotWebhookSignature,
} from "../../../../../lib/hubspotWebhook";

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

function logWebhook(level: "info" | "error", payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    integration: "hubspot",
    route: "webhook",
    level,
    ...payload,
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  console.info(line);
}

function isPendingQueueState(state: string): boolean {
  return state === "waiting" || state === "active" || state === "delayed" || state === "prioritized" || state === "waiting-children";
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const signature = String(req.headers.get("x-hubspot-signature-v3") || "").trim();
    const timestamp = String(req.headers.get("x-hubspot-request-timestamp") || "").trim();
    const url = requestFullUrl(req);

    const verified = verifyHubSpotWebhookSignature({
      rawBody,
      signature,
      timestamp,
      method: req.method || "POST",
      url,
    });
    if (!verified) {
      logWebhook("error", {
        event: "signature_verification_failed",
        method: req.method || "POST",
        url,
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed: unknown = JSON.parse(rawBody || "[]");
    const dealEvents = extractDealEvents(parsed);
    if (!dealEvents.length) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const portalId = extractPortalId(parsed);
    if (!portalId) {
      logWebhook("error", { event: "missing_portal_id" });
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { rows } = await pool.query<{ org_id: string }>(
      `
      SELECT org_id::text AS org_id
      FROM hubspot_connections
      WHERE hub_id::text = $1
      LIMIT 1
      `,
      [portalId]
    );
    const orgId = Number(rows[0]?.org_id || 0);
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return NextResponse.json({ ok: true, skipped: "unknown_portal" });
    }

    const queue = getIngestQueue();
    if (!queue || QUEUE_NAME !== "opportunity-ingest") {
      logWebhook("error", {
        event: "queue_unavailable",
        orgId,
        portalId,
      });
      return NextResponse.json({ ok: true });
    }

    let queued = 0;
    const uniqueDealIds = Array.from(new Set(dealEvents.map((event) => event.dealId)));
    for (const dealId of uniqueDealIds) {
      const jobId = `hubspot-deal-update_${orgId}_${dealId}`;
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (isPendingQueueState(state)) {
          continue;
        }
        if (state === "failed" || state === "completed") {
          try {
            await existingJob.remove();
          } catch (error) {
            logWebhook("error", {
              event: "job_remove_failed",
              orgId,
              dealId,
              state,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
      }

      await queue.add(
        "hubspot-deal-update",
        { orgId, dealId, syncType: "webhook" },
        {
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      queued += 1;
    }

    return NextResponse.json({ ok: true, queued });
  } catch (error) {
    logWebhook("error", {
      event: "webhook_internal_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: true });
  }
}
