"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps the executive hero (ExecutiveGapInsightsClient heroOnly) on the rep dashboard
 * and hides the Strategic Takeaway panel, which is replaced by the Coaching Brief.
 * Does not modify any executive component; only hides one panel via DOM after mount.
 */
export function RepDashboardHeroWrapper({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hideStrategicTakeaway = () => {
      // Find innermost element containing "Strategic Takeaway" (the span), so we don't match the whole hero container.
      const findInnermostWithText = (node: Node): Element | null => {
        if (node.nodeType !== Node.ELEMENT_NODE) return null;
        const el = node as Element;
        if (!el.textContent?.includes("Strategic Takeaway")) return null;
        for (let i = 0; i < el.children.length; i++) {
          const childFound = findInnermostWithText(el.children[i]);
          if (childFound) return childFound;
        }
        return el;
      };
      const labelEl = findInnermostWithText(container);
      if (!labelEl) return;
      // Panel is the direct wrapper: div with rounded-xl that contains this label (not the whole hero).
      const panel = labelEl.closest("div[class*='rounded-xl'][class*='p-5']");
      if (panel && container.contains(panel)) (panel as HTMLElement).style.display = "none";
    };

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(hideStrategicTakeaway);
    });
    const timeout = setTimeout(hideStrategicTakeaway, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div ref={containerRef} data-rep-dashboard-hero>
      {children}
    </div>
  );
}
