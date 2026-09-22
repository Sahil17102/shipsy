/**
 * Single source of truth for app theme.
 * No hardcoded colors elsewhere — use these tokens or CSS vars derived from them.
 *
 * Palette aligned with the public Shipsy landing page:
 *   primary = Shipsy Blue (#2563EB)
 *   accent  = Cyan delivery highlight (#22D3EE)
 * Font: Plus Jakarta Sans
 */

/* ── Color palette shape (shared by light & dark) ── */

export interface ColorPalette {
  primary: string;
  primaryHover: string;
  primaryBg: string;
  primaryLight: string;

  accent: string;
  accentHover: string;
  accentBg: string;

  text: string;
  textSecondary: string;
  textTertiary: string;

  border: string;
  borderLight: string;

  bg: string;
  bgElevated: string;
  bgPanel: string;
  headerBg: string;
  sidebarBg: string;
  sidebarFg: string;
  sidebarMuted: string;
  sidebarActiveBg: string;
  sidebarActiveFg: string;
  sidebarBorder: string;

  heroDark: string;
  heroGradientEnd: string;

  loadingOverlay: string;

  /** Skeleton shimmer stops */
  skeletonFrom: string;
  skeletonVia: string;

  /** Hero-light gradient endpoints */
  heroLightStart: string;
  heroLightEnd: string;

  /** Dot-grid overlay colors (full rgba value) */
  heroDotColor: string;
  heroLightDotColor: string;

  /** Muted surface for icon/logo backgrounds (replaces bg-gray-50) */
  surfaceMuted: string;

  /** Opaque equivalent of primaryBg — used for fixed table cells to prevent bleed-through */
  primaryBgSolid: string;

  /** Semantic status colors */
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;
  revenue: string;
  revenueBg: string;
  operations: string;
  operationsBg: string;
  danger: string;
  dangerBg: string;
}

/* ── Light palette ── */

export const lightColors: ColorPalette = {
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primaryBg: "rgba(37, 99, 235, 0.10)",
  primaryLight: "#DBEAFE",

  accent: "#22D3EE",
  accentHover: "#2563EB",
  accentBg: "rgba(34, 211, 238, 0.14)",

  text: "#0F172A",
  textSecondary: "#475569",
  textTertiary: "#64748B",

  border: "#D8E3F5",
  borderLight: "rgba(191, 219, 254, 0.72)",

  bg: "#EEF4FB",
  bgElevated: "#FFFFFF",
  bgPanel: "#F8FBFF",
  headerBg: "rgba(255, 255, 255, 0.92)",
  sidebarBg: "#101B2E",
  sidebarFg: "#EAF2FF",
  sidebarMuted: "#93A4BB",
  sidebarActiveBg: "rgba(34, 211, 238, 0.16)",
  sidebarActiveFg: "#FFFFFF",
  sidebarBorder: "rgba(148, 163, 184, 0.18)",

  heroDark: "#0F172A",
  heroGradientEnd: "#1D4ED8",

  loadingOverlay: "rgba(247, 250, 255, 0.92)",

  skeletonFrom: "#EAF1FF",
  skeletonVia: "#DCE9FF",

  heroLightStart: "#EFF6FF",
  heroLightEnd: "#ECFEFF",

  heroDotColor: "rgba(96, 165, 250, 0.22)",
  heroLightDotColor: "rgba(37, 99, 235, 0.055)",

  surfaceMuted: "#F2F7FF",

  primaryBgSolid: "#EAF1FF",

  success: "#16A34A",
  successBg: "#DCFCE7",
  warning: "#D97706",
  warningBg: "#FEF3C7",
  info: "#0EA5E9",
  infoBg: "#E0F2FE",
  revenue: "#0F766E",
  revenueBg: "#CCFBF1",
  operations: "#7C3AED",
  operationsBg: "#EDE9FE",
  danger: "#DC2626",
  dangerBg: "#FEE2E2",
};

/* ── Dark palette ── */

export const darkColors: ColorPalette = {
  primary: "#60A5FA",
  primaryHover: "#93C5FD",
  primaryBg: "rgba(96, 165, 250, 0.16)",
  primaryLight: "#172554",

  accent: "#22D3EE",
  accentHover: "#67E8F9",
  accentBg: "rgba(34, 211, 238, 0.16)",

  text: "#F8FAFC",
  textSecondary: "#CBD5E1",
  textTertiary: "#94A3B8",

  border: "#263B5E",
  borderLight: "rgba(38, 59, 94, 0.7)",

  bg: "#08111F",
  bgElevated: "#0F1A2D",
  bgPanel: "#111F35",
  headerBg: "rgba(15, 26, 45, 0.92)",
  sidebarBg: "#050B14",
  sidebarFg: "#F8FAFC",
  sidebarMuted: "#94A3B8",
  sidebarActiveBg: "rgba(96, 165, 250, 0.18)",
  sidebarActiveFg: "#FFFFFF",
  sidebarBorder: "rgba(148, 163, 184, 0.14)",

  heroDark: "#08111F",
  heroGradientEnd: "#102A56",

  loadingOverlay: "rgba(8, 17, 31, 0.92)",

  skeletonFrom: "#0F1A2D",
  skeletonVia: "#1E3A5F",

  heroLightStart: "#08111F",
  heroLightEnd: "#0F1A2D",

  heroDotColor: "rgba(96, 165, 250, 0.22)",
  heroLightDotColor: "rgba(96, 165, 250, 0.08)",

  surfaceMuted: "#17233A",

  primaryBgSolid: "#172554",

  success: "#4ADE80",
  successBg: "rgba(74, 222, 128, 0.14)",
  warning: "#FBBF24",
  warningBg: "rgba(251, 191, 36, 0.14)",
  info: "#38BDF8",
  infoBg: "rgba(56, 189, 248, 0.14)",
  revenue: "#2DD4BF",
  revenueBg: "rgba(45, 212, 191, 0.14)",
  operations: "#A78BFA",
  operationsBg: "rgba(167, 139, 250, 0.14)",
  danger: "#F87171",
  dangerBg: "rgba(248, 113, 113, 0.14)",
};

/* ── Non-color tokens (shared across modes) ── */

export const theme = {
  color: lightColors,
  fontFamily: {
    sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
  },
  spacing: {
    containerPadding: "1rem",
    containerPaddingSm: "1.5rem",
    sectionGap: "2.5rem",
    contentGap: "1.5rem",
    contentY: "1.5rem",
    contentYSm: "2rem",
    emptyStatePadding: "3rem",
    pageHeaderGap: "1rem",
    pageHeaderMargin: "2rem",
    loadingMinHeight: "200px",
  },
  containerMaxWidth: {
    sm: "48rem",
    md: "56rem",
    lg: "64rem",
    xl: "72rem",
    "2xl": "80rem",
  },
} as const;

export type Theme = typeof theme;

/* ── Theme mode ── */

export type ThemeMode = "light" | "dark";

/* ── CSS variable builders ── */

function buildColorVars(colors: ColorPalette): Record<string, string> {
  return {
    "--color-primary": colors.primary,
    "--color-primary-hover": colors.primaryHover,
    "--color-primary-bg": colors.primaryBg,
    "--color-primary-light": colors.primaryLight,
    "--color-accent": colors.accent,
    "--color-accent-hover": colors.accentHover,
    "--color-accent-bg": colors.accentBg,
    "--color-text": colors.text,
    "--color-text-secondary": colors.textSecondary,
    "--color-text-tertiary": colors.textTertiary,
    "--color-border": colors.border,
    "--color-border-light": colors.borderLight,
    "--color-bg": colors.bg,
    "--color-bg-elevated": colors.bgElevated,
    "--color-bg-panel": colors.bgPanel,
    "--color-header-bg": colors.headerBg,
    "--color-sidebar-bg": colors.sidebarBg,
    "--color-sidebar-fg": colors.sidebarFg,
    "--color-sidebar-muted": colors.sidebarMuted,
    "--color-sidebar-active-bg": colors.sidebarActiveBg,
    "--color-sidebar-active-fg": colors.sidebarActiveFg,
    "--color-sidebar-border": colors.sidebarBorder,
    "--color-hero-dark": colors.heroDark,
    "--color-hero-gradient-end": colors.heroGradientEnd,
    "--color-loading-overlay": colors.loadingOverlay,
    "--color-skeleton-from": colors.skeletonFrom,
    "--color-skeleton-via": colors.skeletonVia,
    "--color-hero-light-start": colors.heroLightStart,
    "--color-hero-light-end": colors.heroLightEnd,
    "--color-hero-dot": colors.heroDotColor,
    "--color-hero-light-dot": colors.heroLightDotColor,
    "--color-surface-muted": colors.surfaceMuted,
    "--color-primary-bg-solid": colors.primaryBgSolid,
    "--color-success": colors.success,
    "--color-success-bg": colors.successBg,
    "--color-warning": colors.warning,
    "--color-warning-bg": colors.warningBg,
    "--color-info": colors.info,
    "--color-info-bg": colors.infoBg,
    "--color-revenue": colors.revenue,
    "--color-revenue-bg": colors.revenueBg,
    "--color-operations": colors.operations,
    "--color-operations-bg": colors.operationsBg,
    "--color-danger": colors.danger,
    "--color-danger-bg": colors.dangerBg,
  };
}

const sharedVars: Record<string, string> = {
  "--font-sans": theme.fontFamily.sans,
  "--radius-sm": `${theme.radius.sm}px`,
  "--radius-md": `${theme.radius.md}px`,
  "--radius-lg": `${theme.radius.lg}px`,
  "--radius-xl": `${theme.radius.xl}px`,
  "--spacing-container": theme.spacing.containerPadding,
  "--spacing-container-sm": theme.spacing.containerPaddingSm,
  "--spacing-section-gap": theme.spacing.sectionGap,
  "--spacing-content-gap": theme.spacing.contentGap,
  "--spacing-content-y": theme.spacing.contentY,
  "--spacing-content-y-sm": theme.spacing.contentYSm,
  "--spacing-empty-state": theme.spacing.emptyStatePadding,
  "--spacing-page-header-gap": theme.spacing.pageHeaderGap,
  "--spacing-page-header-margin": theme.spacing.pageHeaderMargin,
  "--loading-min-height": theme.spacing.loadingMinHeight,
  "--container-max-w-sm": theme.containerMaxWidth.sm,
  "--container-max-w-md": theme.containerMaxWidth.md,
  "--container-max-w-lg": theme.containerMaxWidth.lg,
  "--container-max-w-xl": theme.containerMaxWidth.xl,
  "--container-max-w-2xl": theme.containerMaxWidth["2xl"],
};

export const cssVars = {
  ...buildColorVars(lightColors),
  ...sharedVars,
} as const;

/**
 * Inject theme CSS variables onto :root.
 * Call with a mode to switch palettes; portaled elements (modals, drawers)
 * inherit from :root so this keeps them in sync.
 */
export function injectThemeVars(mode: ThemeMode = "light"): void {
  const root = document.documentElement;
  const colors = mode === "dark" ? darkColors : lightColors;
  const allVars = { ...sharedVars, ...buildColorVars(colors) };

  Object.entries(allVars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Mirror data-theme onto <html> so Tailwind `dark:` utilities also match
  // inside portaled content (Modals, Drawers, Popovers) that mounts on body.
  root.setAttribute("data-theme", mode);
}

/**
 * Returns dark-mode CSS variable overrides as a React CSSProperties object.
 * Apply as `style` on a wrapper element to scope dark mode to its subtree.
 * Returns empty object for light mode (inherits :root light vars).
 */
export function getThemeVarsStyle(
  mode: ThemeMode,
): React.CSSProperties {
  if (mode === "light") return {};
  return buildColorVars(darkColors) as unknown as React.CSSProperties;
}
