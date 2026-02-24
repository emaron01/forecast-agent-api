import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "../../../lib/auth";
import { listFieldMappings, listFieldMappingSets } from "../../../lib/db";
import { resolvePublicTextId } from "../../../lib/publicId";
import { uploadExcelOpportunitiesAction } from "../actions/excelOpportunities";
import { ExcelUploadClient } from "./ExcelUploadClient";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ExcelOpportunitiesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { ctx, orgId } = await requireOrgContext();
  // Excel upload is allowed for all org users (permissions enforced on other admin pages).

  const mappingSetPublicId = sp(searchParams.mappingSetPublicId) || "";
  const mappingSetId = mappingSetPublicId ? await resolvePublicTextId("field_mapping_sets", mappingSetPublicId).catch(() => "") : "";

  const sets = (await listFieldMappingSets({ organizationId: orgId }).catch(() => []))
    .filter((s) => (s.source_system || "").toLowerCase().includes("excel"));

  const prefillMappings = mappingSetId ? await listFieldMappings({ mappingSetId }).catch(() => []) : [];

  return (
    <main className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Excel opportunities upload</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
            Upload an Excel file, map columns, save the format, and ingest opportunities.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ctx.kind === "master" ? (
            <Link
              href="/admin/mapping-sets"
              className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
            >
              Mapping sets
            </Link>
          ) : null}
          <Link
            href="/admin/ingestion"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Ingestion
          </Link>
        </div>
      </div>

      <ExcelUploadClient
        mappingSets={sets}
        prefillSetPublicId={mappingSetPublicId}
        prefillMappings={prefillMappings}
        action={uploadExcelOpportunitiesAction}
        allowDeleteAccounts={ctx.kind === "user" && ctx.user.role === "ADMIN"}
      />
    </main>
  );
}

