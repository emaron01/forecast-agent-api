"use client";

import { useState } from "react";

export type QuarterlySalesForecastExportData = {
  filename: string;
  periodLabel: string;
  stageProbabilitiesLine: string;
  crmActuals: {
    commit: number;
    bestCase: number;
    pipeline: number;
    totalPipeline: number;
    closedWon: number;
    quota: number;
    pctToGoal: number | null;
    leftToGo: number;
  };
  weightedOutlook: {
    crm: {
      commitClosing: number;
      bestCaseClosing: number;
      pipelineClosing: number;
      totalPipelineClosing: number;
      closedWon: number;
      projectedClosedWon: number;
      quota: number;
      projectedPctToGoal: number | null;
      leftToGo: number;
    };
    ai: {
      commitClosing: number;
      bestCaseClosing: number;
      pipelineClosing: number;
      totalPipelineClosing: number;
      closedWon: number;
      projectedClosedWon: number;
      quota: number;
      projectedPctToGoal: number | null;
      leftToGo: number;
    };
    gap: {
      commitClosing: number;
      bestCaseClosing: number;
      pipelineClosing: number;
      totalPipelineClosing: number;
      closedWon: number;
      projectedClosedWon: number;
      quota: number;
      projectedPctToGoal: number | null;
      leftToGo: number;
    };
  };
};

export function ExportQuarterlySalesForecastExcelButton(props: { data: QuarterlySalesForecastExportData }) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    if (busy) return;
    setBusy(true);
    try {
      const mod: any = await import("xlsx");
      const XLSX = mod?.default || mod;

      const d = props.data;
      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.aoa_to_sheet([
        [d.periodLabel],
        [],
        ["CRM Actuals", "Commit", "Best Case", "Pipeline", "Total Pipeline", "Current Closed Won", "Quota", "% To Goal", "Left To Go"],
        [
          "CRM Actuals",
          d.crmActuals.commit,
          d.crmActuals.bestCase,
          d.crmActuals.pipeline,
          d.crmActuals.totalPipeline,
          d.crmActuals.closedWon,
          d.crmActuals.quota,
          d.crmActuals.pctToGoal == null ? "" : d.crmActuals.pctToGoal,
          d.crmActuals.leftToGo,
        ],
        [],
        [d.stageProbabilitiesLine],
      ]);
      XLSX.utils.book_append_sheet(wb, ws1, "CRM Actuals");

      const wo = d.weightedOutlook;
      const ws2 = XLSX.utils.aoa_to_sheet([
        [d.periodLabel],
        [],
        [
          "Quarterly Weighted Outlook",
          "Commit Closing",
          "Best Case Closing",
          "Pipeline Closing",
          "Total Pipeline Closing",
          "Current Closed Won",
          "Projected Closed Won",
          "Quota",
          "Projected % To Goal",
          "Left To Go",
        ],
        [
          "CRM Outlook (Rep-Weighted)",
          wo.crm.commitClosing,
          wo.crm.bestCaseClosing,
          wo.crm.pipelineClosing,
          wo.crm.totalPipelineClosing,
          wo.crm.closedWon,
          wo.crm.projectedClosedWon,
          wo.crm.quota,
          wo.crm.projectedPctToGoal == null ? "" : wo.crm.projectedPctToGoal,
          wo.crm.leftToGo,
        ],
        [
          "SalesForecast.IO Outlook (AI-Weighted)",
          wo.ai.commitClosing,
          wo.ai.bestCaseClosing,
          wo.ai.pipelineClosing,
          wo.ai.totalPipelineClosing,
          wo.ai.closedWon,
          wo.ai.projectedClosedWon,
          wo.ai.quota,
          wo.ai.projectedPctToGoal == null ? "" : wo.ai.projectedPctToGoal,
          wo.ai.leftToGo,
        ],
        [
          "Outlook Gap (AI − CRM)",
          wo.gap.commitClosing,
          wo.gap.bestCaseClosing,
          wo.gap.pipelineClosing,
          wo.gap.totalPipelineClosing,
          wo.gap.closedWon,
          wo.gap.projectedClosedWon,
          wo.gap.quota,
          wo.gap.projectedPctToGoal == null ? "" : wo.gap.projectedPctToGoal,
          wo.gap.leftToGo,
        ],
      ]);
      XLSX.utils.book_append_sheet(wb, ws2, "Weighted Outlook");

      XLSX.writeFile(wb, d.filename || "Quarterly-Sales-Forecast.xlsx");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={busy}
      className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
    >
      {busy ? "Exporting…" : "Export to Excel"}
    </button>
  );
}

