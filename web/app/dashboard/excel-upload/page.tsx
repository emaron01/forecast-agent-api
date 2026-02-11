import Link from "next/link";
import { requireAuth } from "../../../lib/auth";
import { getOrganization, listFieldMappings, listFieldMappingSets } from "../../../lib/db";
import { resolvePublicTextId } from "../../../lib/publicId";
import { uploadExcelOpportunitiesAction } from "../../admin/actions/excelOpportunities";
import { ExcelUploadClient } from "../../admin/excel-opportunities/ExcelUploadClient";
import { UserTopNav } from "../../_components/UserTopNav";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

function sp(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DashboardExcelUploadPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAuth();
  if (ctx.kind === "master") {
    // Master users should use admin tools.
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Excel Upload</h1>
        <p className="mt-2 text-sm text-slate-700">Switch to an organization to upload opportunities.</p>
        <div className="mt-4">
          <Link href="/admin/organizations" className="text-indigo-700 hover:underline">
            Go to organizations
          </Link>
        </div>
      </main>
    );
  }
  if (ctx.user.role === "ADMIN") redirect("/admin");

  const org = await getOrganization({ id: ctx.user.org_id }).catch(() => null);
  const orgName = org?.name || "Organization";

  const staged = sp(searchParams.staged) || "";
  const mappingSetPublicId = sp(searchParams.mappingSetPublicId) || "";
  const mappingSetId = mappingSetPublicId
    ? await resolvePublicTextId("field_mapping_sets", mappingSetPublicId).catch(() => "")
    : "";

  const sets = (await listFieldMappingSets({ organizationId: ctx.user.org_id }).catch(() => []))
    .filter((s) => (s.source_system || "").toLowerCase().includes("excel"));

  const prefillMappings = mappingSetId ? await listFieldMappings({ mappingSetId }).catch(() => []) : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <UserTopNav orgName={orgName} user={ctx.user} />
      <main className="mx-auto max-w-5xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Excel opportunities upload</h1>
            <p className="mt-1 text-sm text-slate-600">Upload an Excel file, map columns, and ingest opportunities.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              Back to dashboard
            </Link>
          </div>
        </div>

      {staged ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Uploaded and staged {staged} rows.
        </div>
      ) : null}

        <div className="mt-6">
          <ExcelUploadClient
            mappingSets={sets}
            prefillSetPublicId={mappingSetPublicId}
            prefillMappings={prefillMappings}
            action={uploadExcelOpportunitiesAction}
          />
        </div>
      </main>
    </div>
  );
}

