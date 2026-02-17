import { expect, test } from "@playwright/test";

const TXT_PATH = "C:/books/《测试书》 - 测试作者.txt";
const TXT_TEXT = [
  "第一章 起始",
  "第一章正文内容。",
  "",
  "第二章 进阶",
  "第二章正文内容。",
].join("\n");

const TXT_CHAPTERS = [
  { title: "第一章 起始", start_offset: 0 },
  { title: "第二章 进阶", start_offset: 18 },
];

test("@smoke 导入后在书架可见，并可完成 TXT 章节跳转", async ({ page }) => {
  await page.addInitScript(
    ({ txtPath, txtText, chapters }) => {
      localStorage.clear();
      window.__TOME_MOCKS__ = {
        open: async (options?: { multiple?: boolean }) => {
          if (options?.multiple) return [txtPath];
          return null;
        },
        invoke: async (cmd: string) => {
          if (cmd === "stat_file") return 1024;
          if (cmd === "read_txt_file") {
            return {
              text: txtText,
              chapters,
              encoding: "UTF-8",
            };
          }
          if (cmd === "scan_books") return [];
          throw new Error(`unexpected command: ${cmd}`);
        },
      };
    },
    {
      txtPath: TXT_PATH,
      txtText: TXT_TEXT,
      chapters: TXT_CHAPTERS,
    }
  );

  await page.goto("/");

  await page.getByTestId("import-books-button").click();
  await expect(page.getByRole("button", { name: "打开测试书" })).toBeVisible();

  await page.getByRole("button", { name: "打开测试书" }).click();
  await expect(page.getByText("第一章 起始")).toBeVisible();

  await page.getByTestId("open-chapters-button").click();
  await page.getByRole("button", { name: "第二章 进阶" }).click();
  await expect(page.getByText("第二章正文内容。")).toBeVisible();
});

test("@smoke 最近阅读进度可在重启后恢复", async ({ page }) => {
  await page.addInitScript(
    ({ txtPath, txtText, chapters }) => {
      const seededBook = {
        id: "book-restore-1",
        path: txtPath,
        format: "txt",
        title: "恢复测试",
        author: "测试作者",
        coverDataUrl: "data:image/png;base64,seed",
        fileSize: 888,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
        progress: {
          position: "18",
          percent: 68,
        },
      };

      localStorage.setItem(
        "tome.store.library.json",
        JSON.stringify({ books: [seededBook] })
      );

      window.__TOME_MOCKS__ = {
        open: async () => null,
        invoke: async (cmd: string) => {
          if (cmd === "read_txt_file") {
            return {
              text: txtText,
              chapters,
              encoding: "UTF-8",
            };
          }
          if (cmd === "stat_file") return 888;
          if (cmd === "scan_books") return [];
          throw new Error(`unexpected command: ${cmd}`);
        },
      };
    },
    {
      txtPath: TXT_PATH,
      txtText: TXT_TEXT,
      chapters: TXT_CHAPTERS,
    }
  );

  await page.goto("/");
  await page.getByRole("button", { name: "打开恢复测试" }).click();
  await expect(page.getByTestId("reading-progress-value")).toHaveText("68%");
});

