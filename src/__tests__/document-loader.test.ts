import { describe, expect, it } from "vitest";
import {
  inferBookDocFormat,
  parseTxtDocumentIdentity,
} from "@/lib/document-loader";

describe("document-loader", () => {
  it("能根据路径推断格式", () => {
    expect(inferBookDocFormat("C:/a/book.epub")).toBe("epub");
    expect(inferBookDocFormat("C:/a/book.PDF")).toBe("pdf");
    expect(inferBookDocFormat("C:/a/book.txt")).toBe("txt");
  });

  it("能从 TXT 文件名解析基础元数据", () => {
    expect(parseTxtDocumentIdentity("C:/books/《三体》 刘慈欣.txt")).toEqual({
      title: "三体",
      author: "刘慈欣",
    });
  });
});
