import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTxtFile } from "@/lib/txt-parser";
import { invokeCommand } from "@/lib/tauri-bridge";

vi.mock("@/lib/tauri-bridge", () => ({
  invokeCommand: vi.fn(),
}));

const mockedInvoke = vi.mocked(invokeCommand);

describe("parseTxtFile", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("把 Rust 章节字段 start_offset 映射为 startOffset", async () => {
    mockedInvoke.mockResolvedValue({
      text: "示例正文",
      chapters: [{ title: "第一章", start_offset: 12 }],
      encoding: "UTF-8",
    } as never);

    const result = await parseTxtFile("C:/books/demo.txt");

    expect(mockedInvoke).toHaveBeenCalledWith("read_txt_file", {
      path: "C:/books/demo.txt",
    });
    expect(result).toEqual({
      text: "示例正文",
      chapters: [{ title: "第一章", startOffset: 12 }],
      encoding: "UTF-8",
    });
  });

  it("读取失败时透传错误", async () => {
    mockedInvoke.mockRejectedValue(new Error("read failed"));

    await expect(parseTxtFile("C:/books/bad.txt")).rejects.toThrow(
      "read failed"
    );
  });
});

