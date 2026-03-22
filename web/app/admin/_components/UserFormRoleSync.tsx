"use client";

import { useLayoutEffect } from "react";

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
      if (t && "name" in t && (t as HTMLInputElement).name === "role") {
        syncUserFormRoleSections(form);
      }
    }

    syncUserFormRoleSections(form);
    form.addEventListener("change", onFormChange);
    return () => form.removeEventListener("change", onFormChange);
  }, []);

  return null;
}
