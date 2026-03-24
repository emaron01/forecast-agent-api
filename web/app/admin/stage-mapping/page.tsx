import { redirect } from "next/navigation";
import { requireAdminOrMaster } from "../../../lib/auth";
import { StageMappingClient } from "./StageMappingClient";

export const runtime = "nodejs";

export default async function StageMappingPage() {
  try {
    const ctx = await requireAdminOrMaster();
    if (ctx.kind === "master") redirect("/admin/control-center");

    return (
      <main className="grid gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Stage &amp; Forecast Category Mapping</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Map CRM forecast category and sales stage values to forecast buckets. Explicit mappings override pattern matching.
          </p>
        </div>
        <StageMappingClient />
      </main>
    );
  } catch (e) {
    console.error("[stage-mapping page crash]", e);
    throw e;
  }
}
