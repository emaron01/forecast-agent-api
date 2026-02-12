// Site-wide theme tokens for SalesForecast.io (dark mode).
//
// IMPORTANT:
// - Outside of the semantic scoring colors, no component should hard-code colors.
// - The semantic scoring colors (#2ECC71/#F1C40F/#E74C3C) must remain hard-coded
//   wherever they drive business logic (deal review highlights, health score, etc.).
// - Do not replace scoring color usage with tokens.

export const palette = {
  // Core surfaces
  background: "#0D1B2A",
  surface: "#1B263B",
  surfaceAlt: "#243447",
  border: "#415A77",

  // Text
  textPrimary: "#F5F7FA",
  textSecondary: "#C7D1DA",
  textDisabled: "#7A8696",

  // Accents
  accentPrimary: "#00C2D1",
  accentPrimaryHover: "#00AAB8",
  accentSecondary: "#4DD7E5",
  accentTertiary: "#5DADE2",

  // Buttons
  buttonPrimaryBg: "#00C2D1",
  buttonPrimaryText: "#0D1B2A",
  buttonPrimaryHover: "#00AAB8",
  buttonSecondaryBg: "#1B263B",
  buttonSecondaryText: "#F5F7FA",
  buttonSecondaryHover: "#243447",

  // Charts (keeps existing series; includes semantic success green)
  chartSeries: ["#00C2D1", "#4DD7E5", "#5DADE2", "#A29BFE", "#E67E22", "#2ECC71"],
} as const;

// Navigation tokens (requested as a separate export).
export const navStyles = {
  background: "#1B263B",
  text: "#F5F7FA",
  hover: "#00C2D1",
  active: "#4DD7E5",
  borderBottom: "#415A77",
} as const;

