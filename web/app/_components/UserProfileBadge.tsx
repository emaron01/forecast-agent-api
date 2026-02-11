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
        className="grid h-9 w-9 place-items-center rounded-full bg-indigo-700 text-sm font-semibold text-white shadow-sm ring-1 ring-indigo-800/30 transition hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        aria-label="User menu"
        title={`${displayName || email}${orgName ? ` · ${orgName}` : ""}`}
      >
        {initials}
      </button>

      <div className="invisible absolute left-1/2 z-50 mt-2 w-64 -translate-x-1/2 origin-top rounded-lg border border-slate-200 bg-white shadow-lg opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:content-['']">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{displayName || email}</div>
          <div className="mt-0.5 text-xs text-slate-500">{orgName || "Organization"}</div>
        </div>

        <div className="py-1">
          {showAccountLink ? (
            <Link
              href="/account"
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Account
            </Link>
          ) : null}

          <form action={logoutAction}>
            <button
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
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

