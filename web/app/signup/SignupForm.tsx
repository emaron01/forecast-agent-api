"use client";

import { useMemo, useState } from "react";

type Role = "ADMIN" | "MANAGER" | "REP";

type UserDraft = {
  role: Role;
  hierarchy_level: 0 | 2 | 3;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  account_owner_name: string;
  manager_email?: string;
};

function emptyUser(role: Role): UserDraft {
  const hierarchy_level = role === "ADMIN" ? 0 : role === "MANAGER" ? 2 : 3;
  return {
    role,
    hierarchy_level,
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    account_owner_name: "",
    manager_email: "",
  };
}

export function SignupForm({ action, error }: { action: (formData: FormData) => void; error: string }) {
  const [orgName, setOrgName] = useState("");
  const [users, setUsers] = useState<UserDraft[]>([emptyUser("ADMIN")]);

  const managerEmails = useMemo(() => {
    return users
      .filter((u) => u.role === "MANAGER")
      .map((u) => (u.email || "").trim().toLowerCase())
      .filter(Boolean);
  }, [users]);

  function setUser(i: number, patch: Partial<UserDraft>) {
    setUsers((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  }

  function addUser(role: Role) {
    setUsers((prev) => [...prev, emptyUser(role)]);
  }

  function removeUser(i: number) {
    setUsers((prev) => prev.filter((_, idx) => idx !== i));
  }

  function scrollToUser(i: number) {
    const el = document.getElementById(`signup-user-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = el.querySelector("input, select, textarea") as HTMLElement | null;
    firstInput?.focus?.();
  }

  return (
    <form action={action} className="mt-6 grid gap-6">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error === "email_taken"
            ? "That email is already in use. Please use a different email address."
            : error === "org_taken"
              ? "That organization name already exists. Please choose a different name."
              : error === "schema_mismatch"
                ? "Database schema mismatch. Please run migrations and try again."
            : error === "invalid_request"
              ? "Please check your inputs and try again."
              : "Could not create your organization. Please try again."}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">Company</div>
            <p className="mt-1 text-sm text-slate-600">Create your organization and initial users.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2a10 10 0 1 0 10 10A10.012 10.012 0 0 0 12 2Zm-1.2 14.2-3.6-3.6 1.4-1.4 2.2 2.2 4.8-4.8 1.4 1.4-6.2 6.2Z"
              />
            </svg>
            Active
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          <label className="text-sm font-medium text-slate-700">Organization name</label>
          <input
            name="org_name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            placeholder="Acme Inc."
            required
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-tight text-slate-900">Users</div>
            <p className="mt-1 text-sm text-slate-600">
              Add ADMIN, MANAGER, and REP users. At least one <span className="font-medium">ADMIN</span> is required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addUser("ADMIN")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              Add ADMIN
            </button>
            <button
              type="button"
              onClick={() => addUser("MANAGER")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              Add MANAGER
            </button>
            <button
              type="button"
              onClick={() => addUser("REP")}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              Add REP
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          {users.map((u, i) => {
            const isFirst = i === 0;
            return (
              <div key={i} id={`signup-user-${i}`} className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">{u.role}</span>
                    <span className="text-sm font-medium text-slate-900">User #{i + 1}</span>
                  </div>
                  <button
                    type="button"
                    disabled={isFirst && users.length === 1}
                    onClick={() => removeUser(i)}
                    className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">Role</label>
                    <select
                      value={u.role}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        const hierarchy_level = role === "ADMIN" ? 0 : role === "MANAGER" ? 2 : 3;
                        setUser(i, { role, hierarchy_level, manager_email: "" });
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="REP">REP</option>
                    </select>
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">Hierarchy level</label>
                    <select
                      value={String(u.hierarchy_level)}
                      onChange={(e) => {
                        const lvl = Number(e.target.value) as 0 | 2 | 3;
                        const role: Role = lvl === 0 ? "ADMIN" : lvl === 2 ? "MANAGER" : "REP";
                        setUser(i, { hierarchy_level: lvl, role, manager_email: "" });
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="0">0 (Admin)</option>
                      <option value="2">2 (Manager)</option>
                      <option value="3">3 (Rep)</option>
                    </select>
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">Email</label>
                    <input
                      value={u.email}
                      onChange={(e) => setUser(i, { email: e.target.value })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      placeholder="user@company.com"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">First name</label>
                    <input
                      value={u.first_name}
                      onChange={(e) => setUser(i, { first_name: e.target.value })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      placeholder="Jane"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">Last name</label>
                    <input
                      value={u.last_name}
                      onChange={(e) => setUser(i, { last_name: e.target.value })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      placeholder="Doe"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-slate-700">Name As It Appears In CRM</label>
                    <input
                      value={u.account_owner_name}
                      onChange={(e) => setUser(i, { account_owner_name: e.target.value })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      placeholder="Jane Doe"
                      required={u.hierarchy_level === 3}
                    />
                    <p className="text-xs font-medium text-slate-600">Required for Reps only.</p>
                  </div>

                  <div className="grid gap-1.5 md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Password (min 8 chars)</label>
                    <input
                      value={u.password}
                      onChange={(e) => setUser(i, { password: e.target.value })}
                      type="password"
                      minLength={8}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      required
                    />
                  </div>

                  {u.role === "REP" ? (
                    <div className="grid gap-1.5 md:col-span-2">
                      <label className="text-sm font-medium text-slate-700">Manager (optional)</label>
                      <select
                        value={(u.manager_email || "").trim().toLowerCase()}
                        onChange={(e) => setUser(i, { manager_email: e.target.value })}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                      >
                        <option value="">(none)</option>
                        {managerEmails.map((em) => (
                          <option key={em} value={em}>
                            {em}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">
                        To assign a manager, add a MANAGER user above and set their email.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-4 rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-900">
            Users added ({users.length})
          </summary>
          <div className="border-t border-slate-200">
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3">role</th>
                    <th className="px-4 py-3">name</th>
                    <th className="px-4 py-3">email</th>
                    <th className="px-4 py-3">account_owner_name</th>
                    <th className="px-4 py-3">manager</th>
                    <th className="px-4 py-3 text-right">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">{u.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        {u.first_name} {u.last_name}
                      </td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{u.account_owner_name}</td>
                      <td className="px-4 py-3">{u.role === "REP" ? (u.manager_email || "") : ""}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
                            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                            Active
                          </span>
                          <button
                            type="button"
                            onClick={() => scrollToUser(i)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                            aria-label={`Edit user ${i + 1}`}
                            title="Edit"
                          >
                            <span className="sr-only">Edit</span>
                            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                              <path
                                fill="currentColor"
                                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.83H5v-.92l9.06-9.06.92.92L5.92 20.08ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82Z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            disabled={i === 0 && users.length === 1}
                            onClick={() => removeUser(i)}
                            className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                            aria-label={`Delete user ${i + 1}`}
                            title="Delete"
                          >
                            <span className="sr-only">Delete</span>
                            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                              <path
                                fill="currentColor"
                                d="M6 7h12l-1 14H7L6 7Zm3-3h6l1 2H8l1-2Zm-3 2h14v2H4V6Z"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>

        <input type="hidden" name="usersJson" value={JSON.stringify(users)} />

        <button className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2">
          Create organization
        </button>

        <div className="mt-3 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-blue-700 hover:underline">
            Sign in
          </a>
        </div>
      </div>
    </form>
  );
}

