export type Theme = "light" | "dark" | "sepia";

export interface ViewSettings {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
}

export interface BookConfig {
  viewSettings: ViewSettings;
}

export interface BookConfigOverride {
  viewSettings?: Partial<ViewSettings>;
}

const ALLOWED_THEMES = new Set<Theme>(["light", "dark", "sepia"]);
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.4;
const MIN_MARGIN = 0;
const MAX_MARGIN = 120;

export function createViewSettings(input: ViewSettings): ViewSettings {
  return { ...input };
}

export function createBookConfig(viewSettings: ViewSettings): BookConfig {
  return {
    viewSettings: createViewSettings(viewSettings),
  };
}

export function normalizeViewSettings(
  input: Partial<ViewSettings> | undefined,
  fallback: ViewSettings
): ViewSettings {
  return {
    theme: normalizeTheme(input?.theme, fallback.theme),
    fontFamily: normalizeFontFamily(input?.fontFamily, fallback.fontFamily),
    fontSize: normalizeNumber(input?.fontSize, fallback.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    lineHeight: normalizeNumber(
      input?.lineHeight,
      fallback.lineHeight,
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT
    ),
    margin: normalizeNumber(input?.margin, fallback.margin, MIN_MARGIN, MAX_MARGIN),
  };
}

export function resolveBookConfig(
  globalViewSettings: ViewSettings,
  override?: BookConfigOverride | null
): BookConfig {
  return {
    viewSettings: normalizeViewSettings(override?.viewSettings, globalViewSettings),
  };
}

export function mergeBookConfig(
  base: BookConfig,
  override?: BookConfigOverride | null
): BookConfig {
  return resolveBookConfig(base.viewSettings, override);
}

export function mergeBookConfigOverride(
  current: BookConfigOverride | undefined,
  patch: Partial<ViewSettings>
): BookConfigOverride {
  const nextViewSettings: Partial<ViewSettings> = {
    ...(current?.viewSettings ?? {}),
  };

  if (patch.theme !== undefined) nextViewSettings.theme = patch.theme;
  if (patch.fontFamily !== undefined) nextViewSettings.fontFamily = patch.fontFamily;
  if (patch.fontSize !== undefined) nextViewSettings.fontSize = patch.fontSize;
  if (patch.lineHeight !== undefined) nextViewSettings.lineHeight = patch.lineHeight;
  if (patch.margin !== undefined) nextViewSettings.margin = patch.margin;

  return {
    viewSettings: nextViewSettings,
  };
}

export function hasBookConfigOverride(
  override?: BookConfigOverride | null
): boolean {
  return !!override?.viewSettings && Object.keys(override.viewSettings).length > 0;
}

function normalizeTheme(value: Theme | undefined, fallback: Theme): Theme {
  return value && ALLOWED_THEMES.has(value) ? value : fallback;
}

function normalizeFontFamily(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized : fallback;
}

function normalizeNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
