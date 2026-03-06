import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfPageItem } from "@/components/reader/PdfReaderView";

describe("PdfPageItem", () => {
  const baseProps = {
    pageIndex: 0,
    height: 600,
    estimatedHeight: 600,
    registerEl: vi.fn(),
    onImageLoaded: vi.fn(),
    onImageError: vi.fn(),
  };

  it("有 url 时渲染 img", () => {
    const html = renderToStaticMarkup(
      React.createElement(PdfPageItem, {
        ...baseProps,
        url: "asset://page.jpg",
        loading: false,
        error: null,
      })
    );

    expect(html).toContain("<img");
    expect(html).toContain('src="asset://page.jpg"');
  });

  it("loading 时显示加载中", () => {
    const html = renderToStaticMarkup(
      React.createElement(PdfPageItem, {
        ...baseProps,
        url: null,
        loading: true,
        error: null,
      })
    );

    expect(html).toContain("pdf-page-loading");
    expect(html).toContain("加载中...");
  });

  it("error 时显示渲染失败", () => {
    const html = renderToStaticMarkup(
      React.createElement(PdfPageItem, {
        ...baseProps,
        url: null,
        loading: false,
        error: "boom",
      })
    );

    expect(html).toContain("pdf-page-error");
    expect(html).toContain("渲染失败");
  });
});
