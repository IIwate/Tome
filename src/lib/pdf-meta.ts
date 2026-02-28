import { invoke } from "@tauri-apps/api/core";

export interface PdfMeta {
  title: string;
  author: string;
  coverDataUrl: string;
}

interface PdfMetaRaw {
  title?: string | null;
  author?: string | null;
  cover_base64?: string | null;
}

function normalizeCoverDataUrl(coverBase64: string | null | undefined): string {
  if (!coverBase64) return "";
  if (coverBase64.startsWith("data:")) return coverBase64;
  return `data:image/jpeg;base64,${coverBase64}`;
}

export async function extractPdfMeta(filePath: string): Promise<PdfMeta> {
  const raw = await invoke<PdfMetaRaw>("extract_pdf_meta", { path: filePath });
  return {
    title: raw.title ?? "未知书名",
    author: raw.author ?? "未知作者",
    coverDataUrl: normalizeCoverDataUrl(raw.cover_base64),
  };
}

