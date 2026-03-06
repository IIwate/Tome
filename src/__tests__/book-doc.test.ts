import { describe, expect, it } from "vitest";
import {
  createBookDocShell,
  fromFoliateToc,
  fromTxtChapters,
} from "@/lib/book-doc";

describe("book-doc", () => {
  it("可将 Foliate TOC 归一化为统一 BookDoc TOC", () => {
    const toc = fromFoliateToc([
      {
        label: "第一章",
        href: "chap-1",
        subitems: [{ label: "1.1", href: "chap-1-1" }],
      },
    ]);

    expect(toc).toEqual([
      {
        label: "第一章",
        href: "chap-1",
        subitems: [{ label: "1.1", href: "chap-1-1", subitems: undefined }],
      },
    ]);
  });

  it("可将 TXT chapters 归一化为统一 BookDoc TOC", () => {
    const toc = fromTxtChapters([
      { title: "第一章", startOffset: 0 },
      { title: "第二章", startOffset: 120 },
    ]);

    expect(toc).toEqual([
      { label: "第一章", href: "0", index: 0 },
      { label: "第二章", href: "120", index: 120 },
    ]);
  });

  it("可创建最小 BookDoc 壳对象", () => {
    const doc = createBookDocShell({
      format: "pdf",
      title: "示例 PDF",
      author: "作者",
      toc: [{ label: "第 1 页", href: "0" }],
    });

    expect(doc.format).toBe("pdf");
    expect(doc.metadata.title).toBe("示例 PDF");
    expect(doc.rendition?.layout).toBe("pre-paginated");
    expect(doc.toc).toHaveLength(1);
  });
});
