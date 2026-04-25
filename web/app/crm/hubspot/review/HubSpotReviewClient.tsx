"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import DealOverview from "./DealOverview";
import ActiveReview from "./ActiveReview";
import type { HubSpotDealState, HubSpotReviewSession } from "./types";

type PageState =
  | { stage: "loading" }
  | { stage: "error"; message: string }
  | { stage: "overview"; session: HubSpotReviewSession }
  | { stage: "review"; session: HubSpotReviewSession; mode: "voice" | "text" };

export default function HubSpotReviewClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const modeParam = searchParams.get("mode");
  const [state, setState] = useState<PageState>({ stage: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ stage: "error", message: "Missing review token" });
      return;
    }

    async function validate() {
      try {
        const res = await fetch(
          `/api/crm/hubspot/extension/validate?token=${encodeURIComponent(token)}`
        );
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);

        const session: HubSpotReviewSession = {
          org_id: json.org_id,
          rep_id: json.rep_id,
          opportunity_id: json.opportunity_id,
          public_id: json.public_id,
          crm_opp_id: json.crm_opp_id ?? "",
          dealState: json.dealState as HubSpotDealState,
        };

        if (modeParam === "voice" || modeParam === "text") {
          setState({ stage: "review", session, mode: modeParam });
        } else {
          setState({ stage: "overview", session });
        }
      } catch (e: any) {
        setState({
          stage: "error",
          message: String(e.message || "Failed to validate session"),
        });
      }
    }

    validate();
  }, [token, modeParam]);

  if (state.stage === "loading") {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-white">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (state.stage === "error") {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-white p-8">
        <div className="text-center">
          <p className="text-red-400 mb-2">Unable to load deal review</p>
          <p className="text-gray-500 text-sm">{state.message}</p>
        </div>
      </div>
    );
  }

  if (state.stage === "overview") {
    return (
      <DealOverview
        dealState={state.session.dealState}
        onStartVoice={() => setState({ stage: "review", session: state.session, mode: "voice" })}
        onStartText={() => setState({ stage: "review", session: state.session, mode: "text" })}
      />
    );
  }

  if (state.stage === "review") {
    return (
      <ActiveReview
        session={state.session}
        token={token}
        mode={state.mode}
        onEndReview={async () => {
          try {
            const res = await fetch(
              `/api/crm/hubspot/extension/validate?token=${encodeURIComponent(token)}`
            );
            const json = await res.json();
            if (json.ok) {
              setState({
                stage: "overview",
                session: {
                  ...state.session,
                  dealState: json.dealState,
                },
              });
              return;
            }
          } catch {}
          setState({ stage: "overview", session: state.session });
        }}
      />
    );
  }

  return null;
}

