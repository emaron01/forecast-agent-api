import Link from "next/link";

export function Modal({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[color:var(--sf-overlay)]">
      <div className="flex min-h-full items-start justify-center p-4">
        <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-xl sm:my-8 sm:max-h-[calc(100vh-4rem)]">
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--sf-border)] px-5 py-4">
            <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{title}</div>
            <Link
              href={closeHref}
              className="rounded-md px-2 py-1 text-sm text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)] hover:text-[color:var(--sf-text-primary)]"
            >
              Close
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

