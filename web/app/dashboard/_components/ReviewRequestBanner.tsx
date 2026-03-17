import Link from "next/link";

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
    <div
      className="rounded-xl border-2 border-amber-400 bg-amber-500/10 p-4 text-sm text-[color:var(--sf-text-primary)] ring-2 ring-amber-400/50"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="text-lg" aria-hidden="true">
          ⚡
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">Matthew Review Requested</h2>
          <p className="mt-1 text-[color:var(--sf-text-secondary)]">{subtext}</p>
          <ul className="mt-2 list-inside list-disc space-y-1.5 text-[color:var(--sf-text-primary)]">
            {deals.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span>
                  &quot;{d.opp_name || "Unnamed deal"}&quot;
                  {d.review_request_note?.trim() ? (
                    <>
                      {" "}
                      <span className="font-medium text-amber-700 dark:text-amber-400">Manager note:</span> &quot;{d.review_request_note}&quot;
                    </>
                  ) : null}
                </span>
                <Link
                  href={`/opportunities/${encodeURIComponent(d.id)}/deal-review`}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500/25 border-2 border-amber-500/60 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500/35 transition-colors"
                >
                  Start Review →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
