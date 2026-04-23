export const runtime = "nodejs";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveHubSpotDeal, getOrCreateEmbedUser, createEmbedSession } from "../../../lib/embedAuth";

function EmbedError({ message }: { message: string }) {
  return (
    <html>
      <body
        style={{
          fontFamily: "sans-serif",
          padding: "24px",
          background: "#0f1117",
          color: "#e2e8f0",
        }}
      >
        <p style={{ fontSize: "14px" }}>{message}</p>
      </body>
    </html>
  );
}

export default async function HubSpotEmbedPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const portalId = String(
    Array.isArray(searchParams.portalId)
      ? searchParams.portalId[0]
      : searchParams.portalId || ""
  ).trim();

  const dealId = String(
    Array.isArray(searchParams.dealId)
      ? searchParams.dealId[0]
      : searchParams.dealId || ""
  ).trim();

  if (!portalId || !dealId) {
    return (
      <EmbedError message="Missing HubSpot context. Please reload this panel." />
    );
  }

  const deal = await resolveHubSpotDeal({ portalId, dealId }).catch(() => null);
  if (!deal) {
    return (
      <EmbedError message="Deal not found in SalesForecast. Please sync your HubSpot deals first." />
    );
  }

  const userId = await getOrCreateEmbedUser(deal.orgId);
  const token = await createEmbedSession(userId);

  const sameSite = (
    process.env.EMBED_COOKIE_SAME_SITE || "none"
  ) as "none" | "lax" | "strict";
  const secure = sameSite === "none"
    ? true
    : process.env.NODE_ENV === "production";

  cookies().set("fa_session", token, {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: 3600,
  });

  redirect(`/opportunities/${deal.opportunityPublicId}/deal-review`);
}
