import { requireOrgContext } from "../../../lib/auth";
import { ExcelCommentsUploadClient } from "./ExcelCommentsUploadClient";

export const runtime = "nodejs";

export default async function IngestCommentsPage() {
  await requireOrgContext();

  return (
    <main className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">
          Ingest Comments from Excel
        </h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
          Upload an Excel file with crm_opp_id and comments/notes columns. Each row is analyzed and stored as evidence for deal review.
        </p>
      </div>

      <ExcelCommentsUploadClient />
    </main>
  );
}
