export function dateOnly(value: any): string {
  if (value == null) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  // Month-Day-Year (date only), never time.
  const mdY = d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  return mdY.replaceAll("/", "-");
}

