import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/reader/ReaderAdapter", () => ({
  getReaderAdapterComponent: () => {
    return function MockReaderAdapter() {
      return React.createElement("div", { "data-testid": "mock-reader-adapter" });
    };
  },
}));

vi.mock("@/components/reader/ControlOverlay", () => ({
  ControlOverlay: ({ title }: { title: string }) => React.createElement("div", null, title),
}));

vi.mock("@/components/reader/ChapterNav", () => ({
  ChapterNav: () => null,
}));

vi.mock("@/components/reader/SettingsPanel", () => ({
  SettingsPanel: () => null,
}));

import { ReaderPage } from "@/components/reader/ReaderPage";
import { useLibraryStore } from "@/stores/library";
import { useReaderStore } from "@/stores/reader";
import { useSettingsStore } from "@/stores/settings";

describe("ReaderPage", () => {
  beforeEach(() => {
    useLibraryStore.setState({ books: [], _hydrated: true, _importing: false });
    useReaderStore.setState({ currentBookId: null, position: null, percent: 0, chapters: [] });
    useSettingsStore.setState({
      theme: "light",
      fontFamily: "system-ui",
      fontSize: 18,
      lineHeight: 1.8,
      margin: 60,
      bookDeleteSkipConfirm: false,
      bookDeleteMode: "library-only",
      pdfCacheBaseDir: "",
      cacheMaxBytes: 256 * 1024 * 1024,
      _hydrated: true,
    });
  });

  it("当书籍不存在时显示兜底提示", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReaderPage, {
        bookId: "missing-book",
        onBack: () => {},
      })
    );

    expect(html).toContain("书籍不存在");
    expect(html).toContain("返回书架");
  });
});
