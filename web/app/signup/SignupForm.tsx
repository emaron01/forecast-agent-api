"use client";

import { useMemo, useState } from "react";

type Role = "ADMIN" | "MANAGER" | "REP";

type UserDraft = {
  role: Role;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  account_owner_name: string;
  manager_email?: string;
};

function emptyUser(role: Role): UserDraft {
  return {
    role,
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
        <div className="rounded-lg border border-[#E74C3C] bg-[color:var(--sf-surface-alt)] px-4 py-3 text-sm text-[color:var(--sf-text-primary)]">
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

      <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Company</div>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">Create your organization and initial users.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-3 py-1 text-sm font-medium text-[#2ECC71]">
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
          <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Organization name</label>
          <input
            name="org_name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
            placeholder="Acme Inc."
            required
          />
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-base font-semibold tracking-tight text-[color:var(--sf-text-primary)]">Users</div>
            <p className="mt-1 text-sm text-[color:var(--sf-text-secondary)]">
              Add ADMIN, MANAGER, and REP users. At least one <span className="font-medium">ADMIN</span> is required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addUser("ADMIN")}
              className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
            >
              Add ADMIN
            </button>
            <button
              type="button"
              onClick={() => addUser("MANAGER")}
              className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
            >
              Add MANAGER
            </button>
            <button
              type="button"
              onClick={() => addUser("REP")}
              className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm hover:bg-[color:var(--sf-surface)]"
            >
              Add REP
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          {users.map((u, i) => {
            const isFirst = i === 0;
            return (
              <div
                key={i}
                id={`signup-user-${i}`}
                className="scroll-mt-6 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-[color:var(--sf-accent-primary)] px-2 py-1 text-xs font-medium text-[color:var(--sf-button-primary-text)]">
                      {u.role}
                    </span>
                    <span className="text-sm font-medium text-[color:var(--sf-text-primary)]">User #{i + 1}</span>
                  </div>
                  <button
                    type="button"
                    disabled={isFirst && users.length === 1}
                    onClick={() => removeUser(i)}
                    className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface)] disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Role</label>
                    <select
                      value={u.role}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        setUser(i, { role, manager_email: "" });
                      }}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="REP">REP</option>
                    </select>
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Email</label>
                    <input
                      value={u.email}
                      onChange={(e) => setUser(i, { email: e.target.value })}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      placeholder="user@company.com"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">First name</label>
                    <input
                      value={u.first_name}
                      onChange={(e) => setUser(i, { first_name: e.target.value })}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      placeholder="Jane"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Last name</label>
                    <input
                      value={u.last_name}
                      onChange={(e) => setUser(i, { last_name: e.target.value })}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      placeholder="Doe"
                      required
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Name As It Appears In CRM</label>
                    <input
                      value={u.account_owner_name}
                      onChange={(e) => setUser(i, { account_owner_name: e.target.value })}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition placeholder:text-[color:var(--sf-text-disabled)] focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      placeholder="Jane Doe"
                      required={u.role === "REP"}
                    />
                    <p className="text-xs font-medium text-[color:var(--sf-text-secondary)]">Required for Reps only.</p>
                  </div>

                  <div className="grid gap-1.5 md:col-span-2">
                    <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Password (min 8 chars)</label>
                    <input
                      value={u.password}
                      onChange={(e) => setUser(i, { password: e.target.value })}
                      type="password"
                      minLength={8}
                      className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      required
                    />
                  </div>

                  {u.role === "REP" ? (
                    <div className="grid gap-1.5 md:col-span-2">
                      <label className="text-sm font-medium text-[color:var(--sf-text-secondary)]">Manager (optional)</label>
                      <select
                        value={(u.manager_email || "").trim().toLowerCase()}
                        onChange={(e) => setUser(i, { manager_email: e.target.value })}
                        className="rounded-lg border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)] outline-none transition focus:border-[color:var(--sf-accent-primary)] focus:ring-2 focus:ring-[color:var(--sf-accent-primary)]"
                      >
                        <option value="">(none)</option>
                        {managerEmails.map((em) => (
                          <option key={em} value={em}>
                            {em}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-[color:var(--sf-text-disabled)]">
                        To assign a manager, add a MANAGER user above and set their email.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-4 rounded-xl border border-[color:var(--sf-border)] bg-[color:var(--sf-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-[color:var(--sf-text-primary)]">
            Users added ({users.length})
          </summary>
          <div className="border-t border-[color:var(--sf-border)]">
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[color:var(--sf-surface-alt)] text-[color:var(--sf-text-secondary)]">
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
                    <tr key={i} className="border-t border-[color:var(--sf-border)]">
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-[color:var(--sf-accent-primary)] px-2 py-1 text-xs font-medium text-[color:var(--sf-button-primary-text)]">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.first_name} {u.last_name}
                      </td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{u.account_owner_name}</td>
                      <td className="px-4 py-3">{u.role === "REP" ? (u.manager_email || "") : ""}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-[#2ECC71] bg-[color:var(--sf-surface-alt)] px-2 py-1 text-[11px] font-medium text-[#2ECC71]">
                            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#2ECC71]" aria-hidden="true" />
                            Active
                          </span>
                          <button
                            type="button"
                            onClick={() => scrollToUser(i)}
                            className="rounded-md border border-[color:var(--sf-border)] px-2 py-1 text-xs hover:bg-[color:var(--sf-surface-alt)]"
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
                            className="rounded-md border border-[#E74C3C] px-2 py-1 text-xs text-[#E74C3C] hover:bg-[color:var(--sf-surface-alt)] disabled:opacity-40"
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

        <button className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-[color:var(--sf-button-primary-bg)] px-4 py-2.5 text-sm font-medium text-[color:var(--sf-button-primary-text)] shadow-sm transition hover:bg-[color:var(--sf-button-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sf-accent-secondary)] focus:ring-offset-2 focus:ring-offset-[color:var(--sf-background)]">
          Create organization
        </button>

        <div className="mt-3 text-center text-sm text-[color:var(--sf-text-secondary)]">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-[color:var(--sf-accent-primary)] hover:text-[color:var(--sf-accent-secondary)] hover:underline">
            Sign in
          </a>
        </div>
      </div>
    </form>
  );
}

