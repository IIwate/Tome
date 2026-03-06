import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { AppSettingsPanel } from "@/components/library/AppSettingsPanel";

describe("AppSettingsPanel", () => {
  it("打开时默认折叠高级设置", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppSettingsPanel, {
        open: true,
        onClose: () => {},
      })
    );

    expect(html).toContain("高级设置");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("缓存目录");
    expect(html).not.toContain("调试模式");
  });
});
