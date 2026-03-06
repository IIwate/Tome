import { invoke } from "@tauri-apps/api/core";
import {
  createBookDocShell,
  fromFoliateToc,
  fromPdfBookmarks,
  fromTxtChapters,
  type BookDoc,
  type BookDocFormat,
  type BookDocMetadata,
} from "@/lib/book-doc";
import { extractEpubMeta } from "@/lib/epub-meta";
import { extractPdfMeta } from "@/lib/pdf-meta";
import { generateTxtCover } from "@/lib/cover-gen";
import { parseTxtFile } from "@/lib/txt-parser";
import { filenameFromPath, parseTxtFilename } from "@/lib/parse-utils";

export interface ImportedDocumentMeta {
  format: BookDocFormat;
  metadata: BookDocMetadata;
  coverDataUrl: string;
}

export interface LoadedDocument {
  format: BookDocFormat;
  bookDoc: BookDoc;
  coverDataUrl: string;
}

interface PdfInfoRaw {
  page_count?: unknown;
  pageCount?: unknown;
  bookmarks?: unknown;
}

export function inferBookDocFormat(filePath: string): BookDocFormat {
  const ext = filePath.toLowerCase().split(".").pop();
  return ext === "epub" ? "epub" : ext === "pdf" ? "pdf" : "txt";
}

export function parseTxtDocumentIdentity(filePath: string): BookDocMetadata {
  const parsed = parseTxtFilename(filenameFromPath(filePath));
  return {
    title: parsed.title,
    author: parsed.author,
  };
}

export async function loadImportedDocumentMeta(
  filePath: string
): Promise<ImportedDocumentMeta> {
  const loaded = await new DocumentLoader(filePath).open();
  return {
    format: loaded.format,
    metadata: loaded.bookDoc.metadata,
    coverDataUrl: loaded.coverDataUrl,
  };
}

export class DocumentLoader {
  constructor(private readonly filePath: string) {}

  async open(): Promise<LoadedDocument> {
    const format = inferBookDocFormat(this.filePath);

    if (format === "epub") {
      const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
        path: this.filePath,
      });
      const uint8 = new Uint8Array(bytes);
      const { parseEpub } = await import("@/lib/foliate");
      const [meta, parsed] = await Promise.all([
        Promise.resolve(extractEpubMeta(uint8)),
        parseEpub(uint8),
      ]);
      return {
        format,
        coverDataUrl: meta.coverDataUrl,
        bookDoc: {
          format,
          metadata: {
            title: meta.title,
            author: meta.author,
            language: parsed.metadata.language,
            identifier: parsed.metadata.identifier,
          },
          rendition:
            parsed.rendition?.layout === "pre-paginated"
              ? { layout: "pre-paginated" }
              : { layout: "reflowable" },
          toc: parsed.toc ? fromFoliateToc(parsed.toc) : [],
        },
      };
    }

    if (format === "pdf") {
      const [meta, info] = await Promise.all([
        extractPdfMeta(this.filePath),
        invoke<PdfInfoRaw>("get_pdf_info", { path: this.filePath }),
      ]);

      return {
        format,
        coverDataUrl: meta.coverDataUrl,
        bookDoc: {
          format,
          metadata: {
            title: meta.title,
            author: meta.author,
          },
          rendition: { layout: "pre-paginated" },
          toc: fromPdfBookmarks(
            Array.isArray(info.bookmarks) ? info.bookmarks : []
          ),
        },
      };
    }

    const content = await parseTxtFile(this.filePath);
    const metadata = parseTxtDocumentIdentity(this.filePath);
    return {
      format,
      coverDataUrl: generateTxtCover(metadata.title),
      bookDoc: {
        ...createBookDocShell({
          format,
          title: metadata.title,
          author: metadata.author,
        }),
        toc: fromTxtChapters(content.chapters),
      },
    };
  }
}
