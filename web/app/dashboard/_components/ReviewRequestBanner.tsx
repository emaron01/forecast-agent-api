export type ReviewRequestBannerProps = {
  deals: {
    id: string;
    opp_name: string;
    requester_name: string | null;
    review_request_note: string | null;
    review_requested_at: string | null;
  }[];
};

export function ReviewRequestBanner(props: ReviewRequestBannerProps) {
  const { deals } = props;
  if (deals.length === 0) return null;

  const count = deals.length;
  const requesterName = deals[0]?.requester_name?.trim() || null;
  const subtext = `${requesterName || "Your manager"} has requested a Matthew review for ${count} deal(s).`;

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-[color:var(--sf-text-primary)]">
      <div className="flex items-start gap-2">
        <span className="text-lg" aria-hidden="true">
          ⚡
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Matthew Review Requested</h2>
          <p className="mt-1 text-[color:var(--sf-text-secondary)]">{subtext}</p>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-[color:var(--sf-text-primary)]">
            {deals.map((d) => (
              <li key={d.id}>
                {d.review_request_note?.trim() ? (
                  <>
                    &quot;{d.opp_name || "Unnamed deal"}&quot; — &quot;{d.review_request_note}&quot;
                  </>
                ) : (
                  <> &quot;{d.opp_name || "Unnamed deal"}&quot;</>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[color:var(--sf-text-secondary)]">
            Find these deals below and click View to start your Matthew review.
          </p>
        </div>
      </div>
    </div>
  );
}
