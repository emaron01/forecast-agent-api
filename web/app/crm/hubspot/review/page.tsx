import { Suspense } from "react";
import HubSpotReviewClient from "./HubSpotReviewClient";

export const metadata = {
  title: "SalesForecast.io Deal Review",
};

export default function HubSpotReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-white">
          Loading...
        </div>
      }
    >
      <HubSpotReviewClient />
    </Suspense>
  );
}

