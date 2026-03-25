"use client";

/** Subtle line under takeaway controls: fresh vs expired cache vs live generation time. */
export function AiTakeawayTimestamp(props: {
  hasContent: boolean;
  isFresh: boolean;
  generatedAt: string | null;
  className?: string;
}) {
  if (!props.hasContent) return null;
  if (props.isFresh) {
    const g = props.generatedAt;
    if (!g) return null;
    return (
      <div className={props.className ?? "mt-2 text-xs text-[color:var(--sf-text-secondary)]"}>
        {g === "cached" ? "Cached" : `Generated at ${g}`}
      </div>
    );
  }
  return (
    <div className={props.className ?? "mt-2 text-xs text-[color:var(--sf-text-secondary)]"}>Last generated over 24 hours ago</div>
  );
}
