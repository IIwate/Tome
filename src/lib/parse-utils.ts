/** 规范化路径：斜杠统一且转小写 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** 从路径中提取文件名（不含扩展名） */
export function filenameFromPath(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  return name.replace(/\.(txt|epub)$/i, "");
}

/** 解析 TXT 文件名，提取书名和作者 */
export function parseTxtFilename(raw: string): { title: string; author: string } {
  const m1 = raw.match(/^《(.+?)》[\s\-—·]*(.*)$/);
  if (m1) {
    const title = m1[1]?.trim() ?? "";
    if (title) return { title, author: m1[2]?.trim() || "佚名" };
  }
  const m2 = raw.match(/^(.+?)\s+[-—]\s+(.+)$/);
  if (m2) {
    const title = m2[1]?.trim() ?? "";
    if (title) return { title, author: m2[2]?.trim() || "佚名" };
  }
  return { title: raw || "未知书名", author: "佚名" };
}

/** 解析相对路径 */
export function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.slice(1);
  const baseDir = base.substring(0, base.lastIndexOf("/") + 1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of relative.split("/")) {
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
    } else if (seg !== "." && seg !== "") {
      parts.push(seg);
    }
  }
  return parts.join("/");
}
