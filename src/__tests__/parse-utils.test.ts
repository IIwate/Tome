import { describe, it, expect } from "vitest";
import {
  parseTxtFilename,
  normalizePath,
  filenameFromPath,
  resolvePath,
} from "@/lib/parse-utils";

describe("parseTxtFilename", () => {
  it("解析书名号 + 作者", () => {
    expect(parseTxtFilename("《三体》刘慈欣")).toEqual({
      title: "三体",
      author: "刘慈欣",
    });
  });

  it("只有书名号，作者回退为佚名", () => {
    expect(parseTxtFilename("《红楼梦》")).toEqual({
      title: "红楼梦",
      author: "佚名",
    });
  });

  it("不误拆不含空格分隔符的英文名", () => {
    expect(parseTxtFilename("Spider-Man")).toEqual({
      title: "Spider-Man",
      author: "佚名",
    });
  });

  it("解析空格 + 破折号分隔的格式", () => {
    expect(parseTxtFilename("书名 - 作者")).toEqual({
      title: "书名",
      author: "作者",
    });
  });

  it("空字符串返回默认值", () => {
    expect(parseTxtFilename("")).toEqual({
      title: "未知书名",
      author: "佚名",
    });
  });

  it("普通文件名作为书名", () => {
    expect(parseTxtFilename("普通文件名")).toEqual({
      title: "普通文件名",
      author: "佚名",
    });
  });
});

describe("normalizePath", () => {
  it("反斜杠转正斜杠并转小写", () => {
    expect(normalizePath("C:\\Users\\book.epub")).toBe("c:/users/book.epub");
  });

  it("已规范的路径不变", () => {
    expect(normalizePath("already/normal")).toBe("already/normal");
  });
});

describe("filenameFromPath", () => {
  it("从 Windows 路径提取文件名", () => {
    expect(filenameFromPath("C:\\Users\\三体.epub")).toBe("三体");
  });

  it("从 Posix 路径提取文件名", () => {
    expect(filenameFromPath("/path/to/book.txt")).toBe("book");
  });

  it("无扩展名保持原样", () => {
    expect(filenameFromPath("noext")).toBe("noext");
  });
});

describe("resolvePath", () => {
  it("解析上级目录相对路径", () => {
    expect(resolvePath("OEBPS/content.opf", "../images/cover.jpg")).toBe(
      "images/cover.jpg"
    );
  });

  it("多级回退不越过根目录", () => {
    expect(resolvePath("OEBPS/content.opf", "../../cover.jpg")).toBe(
      "cover.jpg"
    );
  });

  it("解析同级文件", () => {
    expect(resolvePath("content.opf", "chapter1.xhtml")).toBe(
      "chapter1.xhtml"
    );
  });

  it("绝对路径移除前导斜杠", () => {
    expect(resolvePath("a/b/c.opf", "/absolute.xml")).toBe("absolute.xml");
  });
});
