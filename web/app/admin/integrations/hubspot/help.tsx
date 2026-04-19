export function HubspotIntegrationHelp() {
  return (
    <div className="mt-10 max-w-3xl space-y-6 text-sm text-[color:var(--sf-text-secondary)]">
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">What gets synced</h2>
        <p className="mt-2">
          Deals from the last two quarters through one quarter forward within your active forecast window are synced — not your entire HubSpot history.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Field mapping</h2>
        <p className="mt-2">
          Map your deal properties to SalesForecast fields in Step 2. Company name is automatically pulled from your HubSpot company associations — no mapping
          required.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Notes &amp; scoring</h2>
        <p className="mt-2">
          Notes and call content are the primary input for the initial AI score, the same role as the Comments column in Excel ingest. Strong notes produce a stronger first-pass assessment.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">No MEDDPICC fields?</h2>
        <p className="mt-2">
          That is fine — we score from your deal data and notes. Matthew develops the MEDDPICC picture through live forecast reviews.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Score writeback to HubSpot</h2>
        <p className="mt-2">
          Optional writeback creates a &quot;SalesForecast.io&quot; property group on deals with eight fields: Overall Health, AI Verdict, Score Source, Top Risk
          Categories, Last Reviewed, Review Count, Risk Summary (Matthew&apos;s assessment of deal risk in plain language), and Next Steps (Matthew&apos;s
          recommended actions for the rep). Your native HubSpot fields are never overwritten.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Disconnect</h2>
        <p className="mt-2">
          Your synced deals remain in SalesForecast.io. HubSpot data is not deleted or modified by disconnect, except when writeback is enabled and you
          previously allowed custom SalesForecast.io properties to be written.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">Sync frequency</h2>
        <p className="mt-2">
          The initial sync runs once after you save mappings. Ongoing updates use HubSpot webhooks for near real-time changes, with a manual &quot;Sync
          Now&quot; option as a backup.
        </p>
      </section>
      <section>
        <h2 className="text-base font-semibold text-[color:var(--sf-text-primary)]">FAQ</h2>
        <dl className="mt-3 space-y-4">
          <div>
            <dt className="font-medium text-[color:var(--sf-text-primary)]">Will this change my HubSpot data?</dt>
            <dd className="mt-1">
              Only if you turn on Score Writeback, which creates and updates the eight SalesForecast.io custom properties. Nothing else is written.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--sf-text-primary)]">What if my deal stages don&apos;t match?</dt>
            <dd className="mt-1">Map your stage field here — SalesForecast.io uses that mapping when ingesting forecast stage.</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--sf-text-primary)]">What if I don&apos;t have notes in HubSpot?</dt>
            <dd className="mt-1">Deals still receive an initial score from metadata. Matthew reviews refine the full picture.</dd>
          </div>
          <div>
            <dt className="font-medium text-[color:var(--sf-text-primary)]">How is this different from HubSpot&apos;s forecast?</dt>
            <dd className="mt-1">
              HubSpot reflects what reps type in. SalesForecast.io reflects what Matthew hears in the actual conversation and your structured review
              workflow.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
