"use client";

import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import helpContentJson from "../../public/help-content.json";

export type HelpContentItem = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  tags: string[];
};

const helpContent = helpContentJson as HelpContentItem[];

const fuse = new Fuse(helpContent, {
  keys: ["title", "summary", "detail", "tags"],
  threshold: 0.35,
  includeScore: true,
});

const navTriggerClass =
  "rounded-md px-2 py-0.5 text-[12px] font-medium leading-none text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface)] hover:text-[color:var(--sf-text-primary)]";

export function HelpSearchDropdown() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
        setExpandedId(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        setExpandedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    setExpandedId(null);
  }, [query]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return fuse.search(q).map((r) => r.item);
  }, [query]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (!next) {
        setQuery("");
        setExpandedId(null);
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={toggleOpen} className={navTriggerClass} aria-expanded={open} aria-haspopup="dialog">
        Help
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-1 max-h-[480px] w-[420px] overflow-y-auto shadow-lg"
          style={{
            backgroundColor: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
          }}
          role="dialog"
          aria-label="Help search"
        >
          <div className="p-3">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-2 py-1.5 text-sm text-[color:var(--sf-text-primary)] placeholder:text-[color:var(--sf-text-disabled)]"
              autoComplete="off"
            />
          </div>
          {results === null ? (
            <p
              className="px-3 pb-3 text-[12px]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Search features, metrics, and tabs...
            </p>
          ) : results.length === 0 ? (
            <p
              className="px-3 pb-3 text-[12px]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {`No results for '${query.trim()}' — try a different term`}
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {results.map((item) => {
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
                      onClick={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
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
          )}
        </div>
      ) : null}
    </div>
  );
}
