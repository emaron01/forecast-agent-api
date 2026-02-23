/**
 * CRM provider interface for fetching opportunity notes/comments.
 * Phase 1: stub only. Phase 3 will implement full integration.
 */
export type CrmProviderFetchNotesResult = {
  ok: boolean;
  notes?: string;
  error?: string;
};

export interface CrmNotesProvider {
  /** Fetch recent notes/comments for an opportunity. */
  fetchNotesForOpportunity(args: {
    orgId: number;
    opportunityId: number;
    crmOppId?: string;
  }): Promise<CrmProviderFetchNotesResult>;
}
