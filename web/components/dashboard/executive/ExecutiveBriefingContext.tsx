"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type ExecutiveBriefingState = {
  quarterOutlook: string;
  forecastCommit: string;
  pipelineRisk: string;
  directVsPartner: string;
};

const defaultState: ExecutiveBriefingState = {
  quarterOutlook: "",
  forecastCommit: "",
  pipelineRisk: "",
  directVsPartner: "",
};

type ExecutiveBriefingContextValue = ExecutiveBriefingState & {
  setQuarterOutlook: (v: string) => void;
  setForecastCommit: (v: string) => void;
  setPipelineRisk: (v: string) => void;
  setDirectVsPartner: (v: string) => void;
};

const ExecutiveBriefingContext = createContext<ExecutiveBriefingContextValue | null>(null);

export function ExecutiveBriefingProvider(props: { children: ReactNode }) {
  const [quarterOutlook, setQuarterOutlook] = useState("");
  const [forecastCommit, setForecastCommit] = useState("");
  const [pipelineRisk, setPipelineRisk] = useState("");
  const [directVsPartner, setDirectVsPartner] = useState("");

  const value = useMemo<ExecutiveBriefingContextValue>(
    () => ({
      quarterOutlook,
      forecastCommit,
      pipelineRisk,
      directVsPartner,
      setQuarterOutlook,
      setForecastCommit,
      setPipelineRisk,
      setDirectVsPartner,
    }),
    [quarterOutlook, forecastCommit, pipelineRisk, directVsPartner]
  );

  return (
    <ExecutiveBriefingContext.Provider value={value}>
      {props.children}
    </ExecutiveBriefingContext.Provider>
  );
}

export function useExecutiveBriefing(): ExecutiveBriefingContextValue {
  const ctx = useContext(ExecutiveBriefingContext);
  if (!ctx) {
    return {
      ...defaultState,
      setQuarterOutlook: () => {},
      setForecastCommit: () => {},
      setPipelineRisk: () => {},
      setDirectVsPartner: () => {},
    };
  }
  return ctx;
}
