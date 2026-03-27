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
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-5 mb-5">
          <h3 className="text-sm font-semibold text-[color:var(--sf-text-primary)] mb-2">How Stage Mapping Works</h3>
          <p className="text-sm text-[color:var(--sf-text-secondary)]">
            SalesForecast.io buckets every deal into one of five categories:{" "}
            <strong className="text-[color:var(--sf-text-primary)]">Commit, Best Case, Pipeline, Won, or Lost</strong>. These
            mappings control how your CRM stages translate into forecast buckets.{" "}
            <strong className="text-[color:var(--sf-text-primary)]">
              Forecast Stage mappings take priority. Sales Stage mappings only override when explicitly configured.
            </strong>
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
