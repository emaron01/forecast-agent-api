"use client";

import { useEffect, useState } from "react";
import { relinkRepDealsForUserAction } from "../actions/reps";

export function RelinkDealsButton(props: { userPublicId: string; crmOwnerName: string | null }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = String(props.crmOwnerName ?? "").trim();
  const disabled = !trimmed;

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy}
        title={disabled ? "Set CRM Name first" : undefined}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await relinkRepDealsForUserAction(props.userPublicId);
            if (r.ok === true) {
              setMsg(r.relinked > 0 ? `${r.relinked} deal${r.relinked === 1 ? "" : "s"} re-linked` : "No unlinked deals");
            } else {
              setMsg(r.error);
            }
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-50"
      >
        Re-link Deals
      </button>
      {msg ? <span className="text-xs text-[color:var(--sf-text-secondary)]">{msg}</span> : null}
    </span>
  );
}
