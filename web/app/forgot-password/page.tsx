"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

const GENERIC = "If that email is registered, a reset link has been sent.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
    } catch {
      // always show generic message
    }
    setSubmitted(true);
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Forgot password</h1>
        <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Enter your work email. We will email a reset link if the account exists.</p>

        {submitted ? (
          <div className="mt-4 rounded-md border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
            {GENERIC}
          </div>
        ) : null}

        {!submitted ? (
          <form onSubmit={onSubmit} className="mt-5 grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="mt-2 rounded-md bg-[color:var(--sf-button-primary-bg)] px-4 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send reset link"}
            </button>

            <div className="mt-2 flex items-center justify-between text-sm">
              <Link href="/login" className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline">
                Back to login
              </Link>
              <Link href="/" className="text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:underline">
                Home
              </Link>
            </div>
          </form>
        ) : (
          <div className="mt-5 flex items-center justify-between text-sm">
            <Link href="/login" className="text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline">
              Back to login
            </Link>
            <Link href="/" className="text-[color:var(--sf-text-secondary)] hover:text-[color:var(--sf-text-primary)] hover:underline">
              Home
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
