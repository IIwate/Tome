import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "@/stores/library";
import { openDialog, invokeCommand } from "@/lib/tauri-bridge";

vi.mock("@/lib/tauri-bridge", () => ({
  openDialog: vi.fn(),
  invokeCommand: vi.fn(),
}));

vi.mock("@/lib/cover-gen", () => ({
  generateTxtCover: (title: string) => `cover:${title}`,
}));

const mockedOpen = vi.mocked(openDialog);
const mockedInvoke = vi.mocked(invokeCommand);

describe("useLibraryStore.importFiles", () => {
  beforeEach(() => {
    mockedOpen.mockReset();
    mockedInvoke.mockReset();
    useLibraryStore.setState({
      books: [],
      _hydrated: false,
      _importing: false,
    });
  });

  it("导入 TXT 后写入书架并完成文件名解析", async () => {
    mockedOpen.mockResolvedValue(["C:/books/《三体》 - 刘慈欣.txt"] as never);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stat_file") return 2048 as never;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await useLibraryStore.getState().importFiles();
    const { books } = useLibraryStore.getState();

    expect(books).toHaveLength(1);
    expect(books[0]?.title).toBe("三体");
    expect(books[0]?.author).toBe("刘慈欣");
    expect(books[0]?.format).toBe("txt");
  });

  it("按路径去重（忽略大小写和斜杠差异）", async () => {
    mockedOpen.mockResolvedValue(
      ["C:\\books\\demo.txt", "c:/books/demo.txt"] as never
    );
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stat_file") return 1024 as never;
      throw new Error(`unexpected command: ${cmd}`);
    });

    await useLibraryStore.getState().importFiles();
    const { books } = useLibraryStore.getState();

    expect(books).toHaveLength(1);
  });
});

