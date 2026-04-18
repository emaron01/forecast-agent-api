"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import "react-quill/dist/quill.snow.css";

const ReactQuill = dynamic(() => import("react-quill"), { ssr: false, loading: () => <p className="text-sm text-[color:var(--sf-text-secondary)]">Loading editor…</p> });

const TEMPLATE_TYPES = ["admin_welcome", "user_welcome", "password_reset"] as const;
type TemplateType = (typeof TEMPLATE_TYPES)[number];

function stripHtmlTags(html: string) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compilePreview(html: string, vars: Record<string, string>) {
  let s = String(html || "");
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(v);
  }
  return s;
}

const PREVIEW_VARS: Record<string, string> = {
  name: "Jane Smith",
  org_name: "Acme Corp",
  set_password_link: "#",
  reset_link: "#",
  login_url: "#",
};

export default function EmailTemplatesPage() {
  const [active, setActive] = useState<TemplateType>("admin_welcome");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const previewHtml = useMemo(() => compilePreview(bodyHtml, PREVIEW_VARS), [bodyHtml]);

  const load = useCallback(async (type: TemplateType) => {
    setLoadError(null);
    setStatus(null);
    try {
      const r = await fetch(`/api/admin/email-templates/${encodeURIComponent(type)}`, { credentials: "include" });
      if (r.status === 401) {
        setLoadError("You must be signed in as the SaaS owner to manage templates.");
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.template) {
        setLoadError(String(j?.error || "Failed to load template."));
        return;
      }
      setSubject(String(j.template.subject || ""));
      setBodyHtml(String(j.template.body_html || ""));
    } catch {
      setLoadError("Failed to load template.");
    }
  }, []);

  useEffect(() => {
    void load(active);
  }, [active, load]);

  async function onSave() {
    setSaving(true);
    setStatus(null);
    try {
      const body_text = stripHtmlTags(bodyHtml);
      const r = await fetch(`/api/admin/email-templates/${encodeURIComponent(active)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject, body_html: bodyHtml, body_text }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(String(j?.error || "Save failed."));
        setSaving(false);
        return;
      }
      setStatus("Saved.");
    } catch {
      setStatus("Save failed.");
    }
    setSaving(false);
  }

  return (
    <main>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Email templates</h1>
          <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Global templates for outbound email (SaaS owner only).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/control-center"
            className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
          >
            Owner control center
          </Link>
        </div>
      </div>

      {loadError ? (
        <div className="mt-4 rounded-md border border-[#E74C3C] bg-[color:var(--sf-surface)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
          {loadError}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {TEMPLATE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            className={`rounded-md border px-3 py-2 text-xs font-medium ${
              active === t
                ? "border-[color:var(--sf-accent-primary)] bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-primary)]"
                : "border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Body (HTML)</label>
              <div className="rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)]">
                <ReactQuill theme="snow" value={bodyHtml} onChange={setBodyHtml} className="bg-[color:var(--sf-surface-alt)]" />
              </div>
              <p className="text-xs text-[color:var(--sf-text-disabled)]">
                Placeholders: {"{{name}}"}, {"{{org_name}}"}, {"{{set_password_link}}"}, {"{{reset_link}}"}, {"{{login_url}}"}.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void load(active)}
                className="rounded-md border border-[color:var(--sf-border)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface-alt)]"
              >
                Reload
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSave()}
                className="rounded-md bg-[color:var(--sf-button-primary-bg)] px-3 py-2 text-sm font-medium text-[color:var(--sf-button-primary-text)] hover:bg-[color:var(--sf-button-primary-hover)] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {status ? <div className="text-sm text-[color:var(--sf-text-secondary)]">{status}</div> : null}
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-4 shadow-sm">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">Preview</div>
          <p className="mt-1 text-xs text-[color:var(--sf-text-secondary)]">Sample variables are substituted for display only.</p>
          <div className="mt-3 rounded-md border border-[color:var(--sf-border)] bg-white p-3 text-sm text-[color:var(--sf-text-primary)]">
            <div className="mb-2 text-xs font-medium text-[color:var(--sf-text-secondary)]">Subject</div>
            <div className="mb-4 font-medium">{compilePreview(subject, PREVIEW_VARS)}</div>
            <div className="mb-2 text-xs font-medium text-[color:var(--sf-text-secondary)]">Body</div>
            <div className="max-w-none text-sm leading-relaxed [&_a]:text-[color:var(--sf-accent-primary)]" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    </main>
  );
}
