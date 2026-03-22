"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type Role = "ADMIN" | "EXEC_MANAGER" | "MANAGER" | "REP" | "FORECAST_AGENT";

export type RoleOption = {
  role: Role;
  label: string;
};

export function RoleSelect(props: {
  userId: string;
  orgId: number;
  currentRole: string | null;
  roleOptions: ReadonlyArray<RoleOption>;
  /**
   * When true, keeps behavior consistent with the in-org admin page:
   * unknown roles are displayed via placeholder but the dropdown is non-editable.
   */
  disableIfUnknown?: boolean;
}) {
  const { userId, orgId, currentRole, roleOptions } = props;
  const disableIfUnknown = !!props.disableIfUnknown;

  const knownRoles = useMemo(() => new Set(roleOptions.map((r) => r.role)), [roleOptions]);
  const currentRoleStr = currentRole == null ? "" : String(currentRole);
  const isKnown = knownRoles.has(currentRoleStr as Role);

  const selectRef = useRef<HTMLSelectElement | null>(null);
  const prevValueRef = useRef<string>("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  // Keep previous value updated when server-rendered props change.
  useEffect(() => {
    const nextPrev = isKnown ? currentRoleStr : "";
    prevValueRef.current = nextPrev;
    if (selectRef.current) selectRef.current.value = nextPrev;
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoleStr, isKnown]);

  async function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextRole = String(e.target.value || "");
    if (!nextRole) return;

    const prevRole = String(prevValueRef.current || "");
    setError("");
    setSaving(true);

    try {
      const res = await fetch("/api/admin/users/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: nextRole, orgId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = typeof body?.error === "string" && body.error ? body.error : "Failed to update user role.";
        // Revert the select to the previous role in case server rejects the request.
        if (selectRef.current) selectRef.current.value = prevRole;
        setError(msg);
        return;
      }

      // Keep existing UX: reload to reflect the updated role.
      window.location.reload();
    } catch (err) {
      if (selectRef.current) selectRef.current.value = prevRole;
      setError("Failed to update user role.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-2">
      <select
        ref={selectRef}
        key={`${userId}:${isKnown ? currentRoleStr : ""}`}
        defaultValue={isKnown ? currentRoleStr : ""}
        onChange={onChange}
        disabled={saving || (disableIfUnknown && !isKnown)}
        className="w-44 rounded-md border border-[color:var(--sf-border)] bg-[color:var(--sf-surface-alt)] px-3 py-2 text-sm text-[color:var(--sf-text-primary)]"
      >
        {!isKnown ? (
          <option value="" disabled>
            Unknown: {currentRoleStr || "—"}
          </option>
        ) : null}

        {roleOptions.map((r) => (
          <option key={r.role} value={r.role}>
            {r.label}
          </option>
        ))}
      </select>

      {error ? <span className="mt-1 text-xs text-[#E74C3C]">{error}</span> : null}
    </div>
  );
}

