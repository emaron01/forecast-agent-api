"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { ExecTabKey } from "../../actions/execTabConstants";

export function ScopedDashboardTabsClient(props: {
  initialTab: ExecTabKey;
  allowedTabKeys: readonly ExecTabKey[];
  tabLabels: Partial<Record<ExecTabKey, string>>;
  setDefaultTab: (tab: ExecTabKey) => Promise<void>;
  panels: Partial<Record<ExecTabKey, ReactNode>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ExecTabKey>(props.initialTab);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setActiveTab(props.initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialTab]);

  const updateUrl = (tab: ExecTabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTabClick = (tab: ExecTabKey) => {
    setActiveTab(tab);
    updateUrl(tab);
  };

  const handleSetDefault = () => {
    startTransition(() => {
      void props.setDefaultTab(activeTab);
    });
  };

  const tabClasses = (tab: ExecTabKey) =>
    [
      "px-3 py-2 text-sm font-medium border-b-2",
      tab === activeTab
        ? "border-[color:var(--sf-accent-primary)] text-[color:var(--sf-text-primary)]"
        : "border-transparent text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:border-[color:var(--sf-border)]",
    ].join(" ");

  const visible = props.allowedTabKeys.map((key) => ({
    key,
    label: props.tabLabels[key] ?? String(key),
  }));

  return (
    <section className="mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabClick(t.key)}
              className={tabClasses(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleSetDefault}
          disabled={isPending}
          className="text-xs text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] disabled:opacity-60"
        >
          Set as my default view
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-4 py-6 text-sm text-[color:var(--sf-text-secondary)]">
        {props.panels[activeTab] ?? <p className="text-[color:var(--sf-text-disabled)]">Nothing to show.</p>}
      </div>
    </section>
  );
}
