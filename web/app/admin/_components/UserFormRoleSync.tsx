"use client";

import { useLayoutEffect } from "react";

function hierarchyLevelForRole(role: string) {
  switch (String(role || "").trim()) {
    case "ADMIN":
      return 0;
    case "EXEC_MANAGER":
      return 1;
    case "MANAGER":
      return 2;
    case "REP":
      return 3;
    case "CHANNEL_EXECUTIVE":
      return 6;
    case "CHANNEL_DIRECTOR":
      return 7;
    case "CHANNEL_REP":
      return 8;
    default:
      return null;
  }
}

function canAssignDirectReportLevel(role: string, targetLevelRaw: string | null) {
  const managerLevel = hierarchyLevelForRole(role);
  const targetLevel = Number(targetLevelRaw);
  if (!Number.isFinite(targetLevel) || managerLevel == null || targetLevel === 0) return false;
  if (managerLevel === 0) {
    return (
      (targetLevel >= 1 && targetLevel <= 3) ||
      (targetLevel >= 6 && targetLevel <= 8)
    );
  }
  if (managerLevel === 1) return targetLevel >= 1;
  if (managerLevel === 2) return targetLevel >= 2;
  if (managerLevel === 6) return targetLevel >= 6;
  if (managerLevel === 7) return targetLevel >= 7;
  return false;
}

function syncAdminExecHierarchySections(form: HTMLFormElement) {
  const roleSelect = form.querySelector<HTMLSelectElement>('select[name="role"]');
  const role = roleSelect ? String(roleSelect.value || "") : "REP";
  const execCb = form.querySelector<HTMLInputElement>('input[name="admin_has_full_analytics_access"]');
  const execOn = role === "ADMIN" && !!(execCb && execCb.checked);
  form.querySelectorAll<HTMLElement>("[data-show-when-admin-exec]").forEach((el) => {
    el.hidden = !execOn;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      "input, select, textarea, button"
    ).forEach((field) => {
      field.disabled = !execOn;
    });
  });
}

function syncUserFormRoleSections(form: HTMLFormElement) {
  const roleSelect = form.querySelector<HTMLSelectElement>('select[name="role"]');
  const role = roleSelect ? String(roleSelect.value || "") : "REP";

  const sections = form.querySelectorAll<HTMLElement>("[data-show-roles]");
  sections.forEach((el) => {
    const rolesAttr = el.getAttribute("data-show-roles") || "";
    const roles = rolesAttr
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const shouldShow = roles.includes(role);
    el.hidden = !shouldShow;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      "input, select, textarea, button"
    ).forEach((field) => {
      field.disabled = !shouldShow;
    });
  });

  // Toggle admin + Executive Dashboard sections before per-row direct report visibility, so row-level
  // disabled state is not overwritten by the broad enable inside [data-show-when-admin-exec].
  syncAdminExecHierarchySections(form);

  const directReportRows = form.querySelectorAll<HTMLElement>("[data-direct-report-level]");
  directReportRows.forEach((el) => {
    const adminExecShell = el.closest<HTMLElement>("[data-show-when-admin-exec]");
    const adminExecOff = !!(adminExecShell && adminExecShell.hidden);
    const levelOk = canAssignDirectReportLevel(role, el.getAttribute("data-direct-report-level"));
    const shouldShow = !adminExecOff && levelOk;
    el.hidden = !shouldShow;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      "input, select, textarea, button"
    ).forEach((field) => {
      field.disabled = !shouldShow;
    });
  });
}

/**
 * Keeps `[data-show-roles]` sections in sync with the Role <select>.
 * Must be a client component: inline scripts do not reliably run after Next.js client navigations.
 */
export function UserFormRoleSync() {
  useLayoutEffect(() => {
    const form = document.querySelector<HTMLFormElement>('form[data-user-form="1"]');
    if (!form) return;

    function onFormChange(e: Event) {
      const t = e.target as HTMLElement | null;
      const name = t && "name" in t ? String((t as HTMLInputElement).name || "") : "";
      if (name === "role" || name === "admin_has_full_analytics_access") {
        syncUserFormRoleSections(form);
      }
    }

    syncUserFormRoleSections(form);
    form.addEventListener("change", onFormChange);
    return () => form.removeEventListener("change", onFormChange);
  }, []);

  return null;
}
