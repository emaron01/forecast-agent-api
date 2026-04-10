"use client";

import Fuse from "fuse.js";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import helpContentJson from "../../public/help-content.json";

export type HelpContentItem = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  tags: string[];
};

const helpContent = helpContentJson as HelpContentItem[];

function normalizeQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(
      /^(what is|what are|what does|how does|how do|where is|where do|tell me about|explain|show me|what's|whats|how to|why is|why does)\s+/i,
      ""
    )
    .replace(/[?]/g, "")
    .trim();
}

function fallbackSearch(query: string): HelpContentItem[] {
  const q = normalizeQuery(query).toLowerCase();
  if (!q) return [];
  return helpContent.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q))
  );
}

const fuse = new Fuse(helpContent, {
  keys: [
    { name: "title", weight: 3 },
    { name: "tags", weight: 2 },
    { name: "summary", weight: 1.5 },
    { name: "detail", weight: 1 },
  ],
  threshold: 0.5,
  distance: 200,
  minMatchCharLength: 2,
  includeScore: true,
  useExtendedSearch: false,
});

function useHelpSearchItems(query: string): HelpContentItem[] | null {
  return useMemo(() => {
    const rawTrim = query.trim();
    if (!rawTrim) return null;
    const normalized = normalizeQuery(query).trim();
    let items = normalized ? fuse.search(normalized).map((r) => r.item) : [];
    if (normalized && items.length === 0) {
      items = fallbackSearch(query);
    }
    return items;
  }, [query]);
}

const userNavHelpTriggerClass =
  "rounded-md px-2 py-0.5 text-[12px] font-medium leading-none text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)] hover:text-[color:var(--sf-text-primary)]";

const adminNavHelpTriggerClass =
  "rounded-md px-2 py-1.5 text-[13px] font-medium text-[color:var(--sf-nav-text)] hover:bg-[color:var(--sf-surface-alt)] hover:text-[color:var(--sf-nav-hover)]";

const panelShellClass =
  "absolute top-full z-50 mt-1 max-h-[480px] w-[420px] overflow-y-auto shadow-lg";

const panelShellStyle: CSSProperties = {
  backgroundColor: "var(--color-background-primary)",
  border: "0.5px solid var(--color-border-secondary)",
};

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

type ResultsBodyProps = {
  query: string;
  items: HelpContentItem[] | null;
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  emptyHint: boolean;
  onCollapseExpandedRow: () => void;
};

function HelpResultsBody({
  query,
  items,
  expandedId,
  setExpandedId,
  emptyHint,
  onCollapseExpandedRow,
}: ResultsBodyProps) {
  if (emptyHint && items === null) {
    return (
      <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--color-text-secondary)" }}>
        Search features, metrics...
      </p>
    );
  }
  if (items === null) return null;
  if (items.length === 0) {
    return (
      <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--color-text-secondary)" }}>
        {`No results for '${query.trim()}' — try a different term`}
      </p>
    );
  }
  return (
    <ul className="m-0 list-none p-0">
      {items.map((item) => {
        const expanded = expandedId === item.id;
        return (
          <li
            key={item.id}
            className="border-b last:border-b-0"
            style={{ borderColor: "var(--color-border-secondary)" }}
          >
            <button
              type="button"
              className="w-full cursor-pointer text-left transition-colors hover:[background-color:var(--color-background-secondary)]"
              style={{ padding: "10px 14px" }}
              onClick={() => {
                if (expandedId === item.id) {
                  setExpandedId(null);
                  onCollapseExpandedRow();
                } else {
                  setExpandedId(item.id);
                }
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-secondary)",
                  marginTop: "2px",
                }}
              >
                {item.summary}
              </div>
              {expanded ? (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-tertiary)",
                    marginTop: "6px",
                    paddingTop: "6px",
                    borderTop: "0.5px solid var(--color-border-tertiary)",
                  }}
                >
                  {item.detail}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Embedded search in main app nav, or Help link + panel for admins / admin paths. */
export function HelpNavSearch({ isAdminUser }: { isAdminUser: boolean }) {
  const pathname = usePathname();
  const showHelpLinkOnly = isAdminUser || pathname.startsWith("/admin");

  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const items = useHelpSearchItems(query);

  useEffect(() => {
    setExpandedId(null);
  }, [query]);

  const resetAll = () => {
    setQuery("");
    setExpandedId(null);
    setPanelOpen(false);
  };

  const closeEmbeddedPanel = () => {
    setQuery("");
    setExpandedId(null);
  };

  useEffect(() => {
    if (!showHelpLinkOnly || !panelOpen) return;
    const t = window.setTimeout(() => linkInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [showHelpLinkOnly, panelOpen]);

  useEffect(() => {
    if (showHelpLinkOnly) {
      if (!panelOpen) return;
      const onPointerDown = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          resetAll();
        }
      };
      document.addEventListener("mousedown", onPointerDown);
      return () => document.removeEventListener("mousedown", onPointerDown);
    }
    if (query.trim().length === 0) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeEmbeddedPanel();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showHelpLinkOnly, panelOpen, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showHelpLinkOnly) {
        if (panelOpen) resetAll();
      } else if (query.trim() || expandedId) {
        closeEmbeddedPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelpLinkOnly, panelOpen, query, expandedId]);

  const inputBaseClass =
    "w-full rounded-[var(--border-radius-md)] border-[0.5px] border-[color:var(--color-border-tertiary)] bg-[color-mix(in_srgb,var(--sf-surface-alt)_35%,transparent)] py-1.5 pl-7 pr-2 text-[13px] text-[color:var(--sf-text-primary)] outline-none transition-[width] duration-200 ease-out placeholder:text-[color:var(--sf-text-disabled)] focus:bg-[color-mix(in_srgb,var(--sf-surface-alt)_55%,transparent)]";

  if (showHelpLinkOnly) {
    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          className={userNavHelpTriggerClass}
          aria-expanded={panelOpen}
          aria-haspopup="dialog"
          onClick={() => setPanelOpen((o) => !o)}
        >
          Help
        </button>
        {panelOpen ? (
          <div
            className={`${panelShellClass} right-0`}
            style={panelShellStyle}
            role="dialog"
            aria-label="Search terms and help"
          >
            <div className="p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--sf-text-secondary)]" />
                <input
                  ref={linkInputRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search features, metrics..."
                  className={`${inputBaseClass} w-full`}
                  style={{ borderRadius: "var(--border-radius-md)" }}
                  autoComplete="off"
                />
              </div>
            </div>
            <HelpResultsBody
              query={query}
              items={items}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              emptyHint
              onCollapseExpandedRow={resetAll}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const embeddedOpen = query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative ml-1 flex min-w-0 items-center">
      <div className="relative w-[220px] transition-[width] duration-200 ease-out focus-within:w-[320px]">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--sf-text-secondary)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search features, metrics..."
          className={inputBaseClass}
          style={{ borderRadius: "var(--border-radius-md)" }}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={embeddedOpen}
        />
      </div>
      {embeddedOpen ? (
        <div
          className={`${panelShellClass} left-0`}
          style={panelShellStyle}
          role="listbox"
          aria-label="Help search results"
        >
          <HelpResultsBody
            query={query}
            items={items}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            emptyHint={false}
            onCollapseExpandedRow={closeEmbeddedPanel}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Help control for admin layout: link-styled trigger + same search panel (anchored, not fixed). */
export function AdminHelpSearch() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useHelpSearchItems(query);

  useEffect(() => {
    setExpandedId(null);
  }, [query]);

  const resetAll = () => {
    setQuery("");
    setExpandedId(null);
    setPanelOpen(false);
  };

  useEffect(() => {
    if (!panelOpen) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        resetAll();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const inputBaseClass =
    "w-full rounded-[var(--border-radius-md)] border-[0.5px] border-[color:var(--color-border-tertiary)] bg-[color:var(--sf-surface-alt)] py-1.5 pl-7 pr-2 text-[13px] text-[color:var(--sf-text-primary)] outline-none placeholder:text-[color:var(--sf-text-disabled)]";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={adminNavHelpTriggerClass}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        onClick={() => setPanelOpen((o) => !o)}
      >
        Help
      </button>
      {panelOpen ? (
        <div
          className={`${panelShellClass} right-0`}
          style={panelShellStyle}
          role="dialog"
          aria-label="Search terms and help"
        >
          <div className="p-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--sf-nav-text)] opacity-80" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search features, metrics..."
                className={inputBaseClass}
                style={{ borderRadius: "var(--border-radius-md)" }}
                autoComplete="off"
              />
            </div>
          </div>
          <HelpResultsBody
            query={query}
            items={items}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            emptyHint
            onCollapseExpandedRow={resetAll}
          />
        </div>
      ) : null}
    </div>
  );
}
