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
      const walk = (node: Node): Element | null => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (el.textContent?.includes("Strategic Takeaway") && el.tagName !== "BODY") {
            const panel = el.closest("[class*='rounded-xl'][class*='p-5']") ?? el.closest("[class*='rounded-xl']");
            if (panel && container.contains(panel)) return panel as Element;
            return el as Element;
          }
          for (let i = 0; i < el.childNodes.length; i++) {
            const found = walk(el.childNodes[i]);
            if (found) return found;
          }
        }
        return null;
      };
      const panel = walk(container);
      if (panel) (panel as HTMLElement).style.display = "none";
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
