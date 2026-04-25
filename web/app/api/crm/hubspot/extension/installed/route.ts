export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");

  if (error) {
    console.error("[hs-extension:installed] OAuth error:", error);
    return new NextResponse(
      `<html><body><h2>Installation failed</h2><p>${error}</p></body></html>`,
      { headers: { "Content-Type": "text/html" }, status: 400 }
    );
  }

  return new NextResponse(
    `<html><body>
      <h2>SalesForecast.io installed successfully</h2>
      <p>You can close this tab and return to HubSpot.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
