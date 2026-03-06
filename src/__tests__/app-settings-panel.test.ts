import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@/components/library/DebugLogDialog", () => ({
  DebugLogDialog: () => null,
}));

import { AppSettingsPanel } from "@/components/library/AppSettingsPanel";

describe("AppSettingsPanel", () => {
  it("打开时渲染 PDF 缓存设置区块", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppSettingsPanel, {
        open: true,
        onClose: () => {},
      })
    );

    expect(html).toContain("PDF 缓存目录");
    expect(html).toContain("清除缓存");
    expect(html).toContain("使用默认");
  });
});
