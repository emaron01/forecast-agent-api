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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40">
      <div className="flex min-h-full items-start justify-center p-4">
        <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:my-8 sm:max-h-[calc(100vh-4rem)]">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <Link
              href={closeHref}
              className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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

