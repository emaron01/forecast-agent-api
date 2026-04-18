"use client";

import { useState } from "react";

const GENERIC = "If that email is registered, a reset link has been sent.";

export function EditUserResetEmailButton(props: { email: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setMsg(null);
    setPending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: props.email }),
        credentials: "include",
      });
    } catch {
      // ignore
    }
    setMsg(GENERIC);
    setPending(false);
  }

  return (
    <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-3">
      <div className="text-sm font-medium text-[color:var(--sf-text-primary)]">Password reset email</div>
      <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Sends the same self-serve reset email as the forgot-password page.</p>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="mt-2 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--sf-text-primary)] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset email"}
      </button>
      {msg ? <div className="mt-2 text-xs text-[color:var(--sf-text-secondary)]">{msg}</div> : null}
    </div>
  );
}
