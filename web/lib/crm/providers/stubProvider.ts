import type { CrmNotesProvider, CrmProviderFetchNotesResult } from "./types";

/**
 * Stub CRM provider. No integration in Phase 1.
 * TODO Phase 3: Implement Salesforce/HubSpot/etc. auth and API calls to fetch
 * opportunity notes/activity. Then call the same ingestion pipeline.
 */
export const stubCrmNotesProvider: CrmNotesProvider = {
  async fetchNotesForOpportunity(): Promise<CrmProviderFetchNotesResult> {
    return {
      ok: false,
      error: "CRM integration not configured. Use manual paste or Excel upload.",
    };
  },
};
