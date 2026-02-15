import Link from "next/link";
import { logoutAction } from "../actions/auth";

function initialsFrom(displayName: string, email?: string) {
  const name = String(displayName || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  const raw = (a + b).trim();
  if (raw) return raw.toUpperCase();
  const em = String(email || "").trim();
  return (em ? em[0] : "U").toUpperCase();
}

export function UserProfileBadge({
  orgName,
  displayName,
  email,
  showAccountLink = true,
}: {
  orgName: string;
  displayName: string;
  email: string;
  showAccountLink?: boolean;
}) {
  const initials = initialsFrom(displayName, email);
  return (
    <div className="relative group">
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--sf-accent-primary)] text-xs font-semibold text-[color:var(--sf-button-primary-text)] shadow-sm ring-1 ring-[color:var(--sf-border)] transition hover:bg-[color:var(--sf-accent-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-secondary)] focus:ring-offset-2 focus:ring-offset-[color:var(--sf-background)]"
        aria-label="User menu"
        title={`${displayName || email}${orgName ? ` · ${orgName}` : ""}`}
      >
        {initials}
      </button>

      <div className="invisible absolute left-1/2 z-50 mt-2 w-64 -translate-x-1/2 origin-top rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] shadow-lg opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:content-['']">
        <div className="border-b border-[color:var(--sf-border)] px-4 py-3">
          <div className="text-sm font-semibold text-[color:var(--sf-text-primary)]">{displayName || email}</div>
          <div className="mt-0.5 text-xs text-[color:var(--sf-text-secondary)]">{orgName || "Organization"}</div>
        </div>

        <div className="py-1">
          {showAccountLink ? (
            <Link
              href="/account"
              className="block px-4 py-2 text-sm text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)] hover:text-[color:var(--sf-text-primary)]"
            >
              Account
            </Link>
          ) : null}

          <form action={logoutAction}>
            <button
              className="block w-full px-4 py-2 text-left text-sm text-[color:var(--sf-text-secondary)] hover:bg-[color:var(--sf-surface-alt)] hover:text-[color:var(--sf-text-primary)]"
              type="submit"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

