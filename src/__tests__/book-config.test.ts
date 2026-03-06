import { describe, expect, it } from "vitest";
import {
  createBookConfig,
  createViewSettings,
  hasBookConfigOverride,
  mergeBookConfig,
  mergeBookConfigOverride,
} from "@/lib/book-config";

describe("book-config", () => {
  it("可创建统一 ViewSettings", () => {
    const settings = createViewSettings({
      theme: "light",
      fontFamily: "system-ui",
      fontSize: 18,
      lineHeight: 1.8,
      margin: 60,
    });

    expect(settings.fontSize).toBe(18);
    expect(settings.theme).toBe("light");
  });

  it("可创建统一 BookConfig", () => {
    const config = createBookConfig({
      theme: "sepia",
      fontFamily: "KaiTi",
      fontSize: 20,
      lineHeight: 2,
      margin: 80,
    });

    expect(config.viewSettings.theme).toBe("sepia");
    expect(config.viewSettings.margin).toBe(80);
  });

  it("可合并每书覆盖配置", () => {
    const base = createBookConfig({
      theme: "light",
      fontFamily: "system-ui",
      fontSize: 18,
      lineHeight: 1.8,
      margin: 60,
    });

    const merged = mergeBookConfig(base, {
      viewSettings: { fontSize: 22, margin: 100 },
    });

    expect(merged.viewSettings.theme).toBe("light");
    expect(merged.viewSettings.fontSize).toBe(22);
    expect(merged.viewSettings.margin).toBe(100);
  });

  it("可累积与检测覆盖层", () => {
    const override = mergeBookConfigOverride(undefined, { fontSize: 24 });
    expect(hasBookConfigOverride(override)).toBe(true);
    expect(override.viewSettings?.fontSize).toBe(24);
  });
});
