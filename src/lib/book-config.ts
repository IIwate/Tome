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

export function createViewSettings(input: ViewSettings): ViewSettings {
  return { ...input };
}

export function createBookConfig(viewSettings: ViewSettings): BookConfig {
  return {
    viewSettings: createViewSettings(viewSettings),
  };
}

export function mergeBookConfig(
  base: BookConfig,
  override?: BookConfigOverride | null
): BookConfig {
  if (!override?.viewSettings) {
    return createBookConfig(base.viewSettings);
  }

  return {
    viewSettings: {
      ...base.viewSettings,
      ...override.viewSettings,
    },
  };
}

export function mergeBookConfigOverride(
  current: BookConfigOverride | undefined,
  patch: Partial<ViewSettings>
): BookConfigOverride {
  return {
    viewSettings: {
      ...(current?.viewSettings ?? {}),
      ...patch,
    },
  };
}

export function hasBookConfigOverride(
  override?: BookConfigOverride | null
): boolean {
  return !!override?.viewSettings && Object.keys(override.viewSettings).length > 0;
}
