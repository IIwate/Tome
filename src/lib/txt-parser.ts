/**
 * TXT 文件解析层
 * 调用 Rust read_txt_file 命令，转换返回的章节数据
 */

import { invoke } from "@tauri-apps/api/core";

export interface TxtChapter {
  title: string;
  startOffset: number;
}

export interface TxtContent {
  text: string;
  chapters: TxtChapter[];
  encoding: string;
}

interface RustTxtContent {
  text: string;
  chapters: { title: string; start_offset: number }[];
  encoding: string;
}

export async function parseTxtFile(path: string): Promise<TxtContent> {
  const raw = await invoke<RustTxtContent>("read_txt_file", { path });
  return {
    text: raw.text,
    chapters: raw.chapters.map((c) => ({
      title: c.title,
      startOffset: c.start_offset,
    })),
    encoding: raw.encoding,
  };
}
