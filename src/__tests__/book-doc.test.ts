import { describe, expect, it } from "vitest";
import {
  createDocumentSession,
  createBookDocShell,
  fromFoliateToc,
  fromPdfBookmarks,
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

  it("可将 PDF 书签归一化为统一 TOC", () => {
    const toc = fromPdfBookmarks([
      { title: "目录", page_index: 3, children: [{ title: "子项", page_index: 5 }] },
    ]);

    expect(toc).toEqual([
      {
        label: "目录",
        href: "3",
        index: 3,
        subitems: [{ label: "子项", href: "5", index: 5, subitems: undefined }],
      },
    ]);
  });

  it("可创建统一 DocumentSession", () => {
    const doc = createBookDocShell({ format: "txt", title: "示例" });
    const session = createDocumentSession({
      id: "book-1",
      format: "txt",
      filePath: "C:/books/demo.txt",
      progress: { position: "10", percent: 8 },
      doc,
    });

    expect(session.filePath).toBe("C:/books/demo.txt");
    expect(session.doc.metadata.title).toBe("示例");
    expect(session.progress.percent).toBe(8);
  });
});
