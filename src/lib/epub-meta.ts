import { unzipSync } from "fflate";

export interface EpubMeta {
  title: string;
  author: string;
  coverDataUrl: string;
}

const DC_NS = "http://purl.org/dc/elements/1.1/";

function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.slice(1);
  const dir = base.substring(0, base.lastIndexOf("/") + 1);
  return dir + relative;
}

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

export function extractEpubMeta(fileBytes: Uint8Array): EpubMeta {
  const files = unzipSync(fileBytes);
  const parser = new DOMParser();

  // 1. 解析 container.xml 获取 OPF 路径
  const containerKey = Object.keys(files).find((k) =>
    k.endsWith("META-INF/container.xml")
  );
  if (!containerKey || !files[containerKey]) {
    throw new Error("无效的 EPUB 文件：缺少 container.xml");
  }
  const containerXml = new TextDecoder().decode(files[containerKey]);
  const containerDoc = parser.parseFromString(
    containerXml,
    "application/xml"
  );
  const rootfile = containerDoc.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath || !files[opfPath]) {
    throw new Error("无效的 EPUB 文件：缺少 OPF");
  }

  // 2. 解析 OPF 获取元数据
  const opfXml = new TextDecoder().decode(files[opfPath]);
  const opfDoc = parser.parseFromString(opfXml, "application/xml");

  const title =
    opfDoc.getElementsByTagNameNS(DC_NS, "title")[0]?.textContent?.trim() ||
    "未知书名";
  const author =
    opfDoc.getElementsByTagNameNS(DC_NS, "creator")[0]?.textContent?.trim() ||
    "未知作者";

  // 3. 查找封面图片
  let coverDataUrl = "";

  // 方法 A: <meta name="cover" content="cover-id">
  const coverMeta = opfDoc.querySelector('meta[name="cover"]');
  const coverId = coverMeta?.getAttribute("content");
  if (coverId) {
    const item = opfDoc.querySelector(`item[id="${coverId}"]`);
    if (item) {
      const href = item.getAttribute("href") || "";
      const fullPath = resolvePath(opfPath, href);
      const bytes = files[fullPath];
      if (bytes) {
        coverDataUrl = bytesToDataUrl(
          bytes,
          item.getAttribute("media-type") || "image/jpeg"
        );
      }
    }
  }

  // 方法 B: <item properties="cover-image">
  if (!coverDataUrl) {
    const items = opfDoc.querySelectorAll("item");
    for (const item of items) {
      const props = item.getAttribute("properties") || "";
      if (props.split(/\s+/).includes("cover-image")) {
        const href = item.getAttribute("href") || "";
        const fullPath = resolvePath(opfPath, href);
        const bytes = files[fullPath];
        if (bytes) {
          coverDataUrl = bytesToDataUrl(
            bytes,
            item.getAttribute("media-type") || "image/jpeg"
          );
        }
        break;
      }
    }
  }

  return { title, author, coverDataUrl };
}
