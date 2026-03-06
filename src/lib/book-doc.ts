import type { FoliateTocItem } from "@/lib/foliate";
import type { TxtChapter } from "@/lib/txt-parser";

export type BookDocFormat = "epub" | "pdf" | "txt";

export interface BookDocMetadata {
  title: string;
  author?: string;
  language?: string | string[];
  identifier?: string;
}

export interface BookDocRendition {
  layout?: "pre-paginated" | "reflowable";
  spread?: "auto" | "none";
  viewport?: { width: number; height: number };
}

export interface BookDocTocItem {
  label: string;
  href: string;
  index?: number;
  subitems?: BookDocTocItem[];
}

export interface BookReadingProgress {
  position: string | null;
  percent: number;
}

export interface DocumentSession {
  id: string;
  format: BookDocFormat;
  filePath: string;
  progress: BookReadingProgress;
  doc: BookDoc;
}

export interface BookDoc {
  format: BookDocFormat;
  metadata: BookDocMetadata;
  rendition?: BookDocRendition;
  toc: BookDocTocItem[];
}

export function fromFoliateToc(items: FoliateTocItem[]): BookDocTocItem[] {
  return items.map((item) => ({
    label: item.label,
    href: item.href,
    subitems: item.subitems ? fromFoliateToc(item.subitems) : undefined,
  }));
}

export function fromTxtChapters(chapters: TxtChapter[]): BookDocTocItem[] {
  return chapters.map((chapter) => ({
    label: chapter.title,
    href: chapter.startOffset.toString(),
    index: chapter.startOffset,
  }));
}

export function fromPdfBookmarks(nodes: unknown[]): BookDocTocItem[] {
  return nodes.map(toPdfBookmarkItem).filter((item): item is BookDocTocItem => !!item);
}

function toPdfBookmarkItem(node: unknown): BookDocTocItem | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title : "";
  const rawIndex = obj.page_index ?? obj.pageIndex ?? obj.page;
  const index =
    typeof rawIndex === "number"
      ? Math.max(0, Math.floor(rawIndex))
      : typeof rawIndex === "string" && Number.isFinite(Number(rawIndex))
        ? Math.max(0, Math.floor(Number(rawIndex)))
        : 0;

  const rawChildren = obj.children ?? obj.subitems ?? obj.items;
  const subitems = Array.isArray(rawChildren)
    ? fromPdfBookmarks(rawChildren)
    : undefined;

  return {
    label: title || `第 ${index + 1} 页`,
    href: index.toString(),
    index,
    subitems: subitems && subitems.length > 0 ? subitems : undefined,
  };
}

export function createBookDocShell(input: {
  format: BookDocFormat;
  title: string;
  author?: string;
  toc?: BookDocTocItem[];
}): BookDoc {
  return {
    format: input.format,
    metadata: {
      title: input.title,
      author: input.author,
    },
    rendition:
      input.format === "pdf"
        ? { layout: "pre-paginated" }
        : { layout: "reflowable" },
    toc: input.toc ?? [],
  };
}

export function createDocumentSession(input: {
  id: string;
  format: BookDocFormat;
  filePath: string;
  progress: BookReadingProgress;
  doc: BookDoc;
}): DocumentSession {
  return {
    id: input.id,
    format: input.format,
    filePath: input.filePath,
    progress: input.progress,
    doc: input.doc,
  };
}
