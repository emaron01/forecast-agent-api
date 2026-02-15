"use client";

import * as XLSX from "xlsx";

type SheetSpec = {
  name: string;
  rows: Array<Record<string, any>>;
};

function safeFilename(name: string) {
  const base = String(name || "export").trim() || "export";
  return base.replace(/[\\/:*?"<>|]+/g, "-");
}

export function ExportToExcelButton(props: {
  fileName: string;
  sheets: SheetSpec[];
  className?: string;
  label?: string;
}) {
  const label = props.label || "Export to Excel";
  const className =
    props.className ||
    "rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]";

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const wb = XLSX.utils.book_new();
        for (const s of props.sheets || []) {
          const ws = XLSX.utils.json_to_sheet(s.rows || []);
          XLSX.utils.book_append_sheet(wb, ws, String(s.name || "Sheet1").slice(0, 31) || "Sheet1");
        }
        const fn = `${safeFilename(props.fileName)}.xlsx`;
        XLSX.writeFile(wb, fn);
      }}
    >
      {label}
    </button>
  );
}

