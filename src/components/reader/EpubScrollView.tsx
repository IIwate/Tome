import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  parseEpub,
  fetchSectionHtml,
  injectShadowStyles,
  type ParsedEpub,
  type FoliateLocation,
  type FoliateTocItem,
} from "@/lib/foliate";
import { useSettingsStore } from "@/stores/settings";

/* ---------- 类型 ---------- */

interface EpubScrollViewProps {
  filePath: string;
  lastPosition?: string | null;
  onRelocate?: (location: FoliateLocation) => void;
  onTocLoaded?: (toc: FoliateTocItem[]) => void;
  onError?: (error: Error) => void;
}

export interface EpubScrollViewHandle {
  goTo: (target: string | number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
}

/* ---------- 工具函数 ---------- */

/** 从 CSS 变量获取计算后的颜色值 */
function getCssColor(varName: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw ? `hsl(${raw})` : "";
}

/** 构建当前排版样式对象 */
function buildStyles(s: {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
}) {
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    margin: s.margin,
    color: getCssColor("--foreground"),
    background: getCssColor("--background"),
  };
}

/**
 * 将 HTML 字符串解析后注入到 ShadowRoot 中。
 * 保留 <head> 中的 <style>/<link>，提取 <body> 内容和属性。
 */
function injectHtmlIntoShadow(shadow: ShadowRoot, html: string): void {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // 1. 从 <head> 提取样式
  for (const node of Array.from(doc.head.children)) {
    const tag = node.tagName;
    if (tag === "STYLE" || (tag === "LINK" && (node as HTMLLinkElement).rel === "stylesheet")) {
      shadow.appendChild(document.importNode(node, true));
    }
  }

  // 2. 创建 body 包裹器，保留 body 上的属性（class、dir 等）
  const wrapper = document.createElement("div");
  wrapper.className = "epub-section-body";
  for (const attr of Array.from(doc.body.attributes)) {
    if (attr.name === "class") {
      wrapper.classList.add(...doc.body.className.split(/\s+/).filter(Boolean));
    } else {
      wrapper.setAttribute(attr.name, attr.value);
    }
  }
  wrapper.innerHTML = doc.body.innerHTML;

  // 3. 安全加固：移除脚本和内联事件
  wrapper.querySelectorAll("script").forEach((el) => el.remove());
  wrapper
    .querySelectorAll("[onclick],[onload],[onerror]")
    .forEach((el) => {
      el.removeAttribute("onclick");
      el.removeAttribute("onload");
      el.removeAttribute("onerror");
    });

  shadow.appendChild(wrapper);
}

/** 找到当前视口顶部可见的 section 索引 */
function findVisibleSectionIndex(
  container: HTMLElement,
  sectionEls: Map<number, HTMLDivElement>
): number {
  const containerTop = container.getBoundingClientRect().top;
  let visible = 0;
  for (const [index, el] of sectionEls) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > containerTop + 1) {
      visible = index;
      break;
    }
  }
  return visible;
}

/** 从 href 提取完整 fragment 并解码 */
function extractFragment(href: string): string | undefined {
  const idx = href.indexOf("#");
  if (idx < 0) return undefined;
  const raw = href.slice(idx + 1);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 在 Shadow DOM 中查找锚点元素并滚动到该位置 */
function scrollToAnchorInSection(
  shadows: Map<number, ShadowRoot>,
  sectionIndex: number,
  fragment: string
): boolean {
  const shadow = shadows.get(sectionIndex);
  if (!shadow || !fragment) return false;
  const escaped = CSS.escape(fragment);
  const el =
    shadow.querySelector(`#${escaped}`) ??
    shadow.querySelector(`[name="${escaped}"]`);
  if (el) {
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  return false;
}

/* ---------- 组件 ---------- */

export const EpubScrollView = forwardRef<
  EpubScrollViewHandle,
  EpubScrollViewProps
>(function EpubScrollView(
  { filePath, lastPosition, onRelocate, onTocLoaded, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<ParsedEpub | null>(null);
  const sectionEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const shadowRoots = useRef<Map<number, ShadowRoot>>(new Map());
  const linearIndices = useRef<number[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRelocateRef = useRef(onRelocate);
  onRelocateRef.current = onRelocate;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);

  // 排版设置
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const margin = useSettingsStore((s) => s.margin);
  const theme = useSettingsStore((s) => s.theme);

  // ---------- 暴露 Handle ----------

  useImperativeHandle(
    ref,
    () => ({
      goTo: async (target: string | number) => {
        const book = bookRef.current;
        if (!book) return;

        let sectionIndex: number | undefined;

        if (typeof target === "number") {
          sectionIndex = target;
        } else if (book.resolveHref) {
          const resolved = book.resolveHref(target);
          if (resolved) sectionIndex = resolved.index;
        }

        if (sectionIndex != null) {
          const fragment = typeof target === "string" ? extractFragment(target) : undefined;
          if (fragment && scrollToAnchorInSection(shadowRoots.current, sectionIndex, fragment)) {
            return;
          }
          const el = sectionEls.current.get(sectionIndex);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
      next: async () => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollBy({
          top: container.clientHeight * 0.9,
          behavior: "smooth",
        });
      },
      prev: async () => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollBy({
          top: -container.clientHeight * 0.9,
          behavior: "smooth",
        });
      },
    }),
    []
  );

  // ---------- 初始化 EPUB ----------

  useEffect(() => {
    const container = containerRef.current;
    const contentEl = contentRef.current;
    if (!container || !contentEl) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. 读取文件
        const bytes = await invoke<ArrayBuffer>("read_file_bytes", {
          path: filePath,
        });
        if (cancelled) return;

        // 2. 解析 EPUB
        const book = await parseEpub(new Uint8Array(bytes));
        if (cancelled) return;
        bookRef.current = book;

        // 3. 固定布局检测
        if (book.rendition?.layout === "pre-paginated") {
          throw new Error("固定布局 EPUB 暂不支持连续滚动模式");
        }

        // 4. 过滤 linear sections
        const indices: number[] = [];
        for (let i = 0; i < book.sections.length; i++) {
          if (book.sections[i]?.linear !== "no") indices.push(i);
        }
        linearIndices.current = indices;

        // 5. 通知 TOC
        if (book.toc) {
          onTocLoaded?.(book.toc);
        }

        // 6. 逐章加载并注入 Shadow DOM
        const styles = buildStyles({ fontFamily, fontSize, lineHeight, margin });
        for (let li = 0; li < indices.length; li++) {
          if (cancelled) return;
          const si = indices[li];
          if (si == null) continue;
          const section = book.sections[si];
          if (!section) continue;

          const html = await fetchSectionHtml(section);
          if (cancelled) return;
          if (!html) continue;

          // 创建宿主 div
          const host = document.createElement("div");
          host.dataset.sectionIndex = String(si);
          host.style.marginBottom = "2em";

          // 创建 Shadow DOM
          const shadow = host.attachShadow({ mode: "open" });

          // 注入排版样式（prepend，优先级高于 EPUB CSS）
          injectShadowStyles(shadow, styles);

          // 注入 EPUB 内容
          injectHtmlIntoShadow(shadow, html);

          // RTL 支持
          if (book.dir === "rtl") {
            const body = shadow.querySelector(".epub-section-body");
            body?.setAttribute("dir", "rtl");
          }

          // 注册引用
          sectionEls.current.set(si, host);
          shadowRoots.current.set(si, shadow);

          // 追加到内容容器
          contentEl.appendChild(host);
        }

        if (cancelled) return;

        // 7. 恢复阅读位置
        if (lastPosition?.startsWith("scroll:")) {
          const parts = lastPosition.split(":");
          const fraction = parseFloat(parts[2] ?? "0");
          requestAnimationFrame(() => {
            if (cancelled) return;
            const effectiveMax = Math.max(
              contentEl.offsetHeight - container.clientHeight,
              0
            );
            container.scrollTop = fraction * effectiveMax;
          });
        }
        // 旧 CFI 格式：尝试定位到对应章节
        // （精确位置无法恢复，只能定位到章节级别）

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("EPUB 加载失败:", msg);
          setError(msg);
          onError?.(err instanceof Error ? err : new Error(msg));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // 清理 Shadow DOM
      sectionEls.current.forEach((el) => el.remove());
      sectionEls.current.clear();
      shadowRoots.current.clear();
      linearIndices.current = [];
      // 释放 blob URL
      const book = bookRef.current;
      if (book) {
        for (const section of book.sections) {
          try {
            section.unload();
          } catch {
            // 忽略
          }
        }
        book.destroy?.();
        bookRef.current = null;
      }
    };
    // filePath 变更时重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ---------- 延迟显示 spinner（避免短加载闪烁） ----------

  useEffect(() => {
    if (!loading) {
      setShowSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(timer);
  }, [loading]);

  // ---------- 设置变更 → 重新注入样式 ----------

  useEffect(() => {
    if (loading) return;
    const styles = buildStyles({ fontFamily, fontSize, lineHeight, margin });
    for (const shadow of shadowRoots.current.values()) {
      injectShadowStyles(shadow, styles);
    }
  }, [fontFamily, fontSize, lineHeight, margin, theme, loading]);

  // ---------- 滚动进度追踪 ----------

  useEffect(() => {
    const container = containerRef.current;
    const contentEl = contentRef.current;
    if (!container || !contentEl || loading) return;

    const flushProgress = () => {
      const { scrollTop, clientHeight } = container;
      const effectiveMax = Math.max(
        contentEl.offsetHeight - clientHeight,
        0
      );
      const scrollPos = Math.min(scrollTop, effectiveMax);
      const fraction = effectiveMax > 0 ? scrollPos / effectiveMax : 0;

      const sectionIndex = findVisibleSectionIndex(
        container,
        sectionEls.current
      );

      const position = `scroll:${sectionIndex}:${fraction.toFixed(6)}`;

      // 尝试匹配当前章节的 TOC 项
      const book = bookRef.current;
      let tocItem: FoliateLocation["tocItem"];
      if (book?.toc) {
        const section = book.sections[sectionIndex];
        if (section) {
          const match = findTocItem(book.toc, section.id);
          if (match) tocItem = match;
        }
      }

      onRelocateRef.current?.({
        fraction,
        cfi: position,
        tocItem,
        index: sectionIndex,
      });
    };

    const handleScroll = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushProgress, 2000);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        flushProgress();
      }
    };
  }, [loading]);

  // ---------- 键盘快捷键 ----------

  useEffect(() => {
    if (loading || error) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector('[role="dialog"], [data-state="open"]')) return;

      const container = containerRef.current;
      if (!container) return;

      const step = container.clientHeight * 0.9;

      switch (e.key) {
        case "ArrowDown":
        case "PageDown":
          e.preventDefault();
          container.scrollBy({ top: step, behavior: "smooth" });
          break;
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          container.scrollBy({ top: -step, behavior: "smooth" });
          break;
        case " ":
          e.preventDefault();
          container.scrollBy({
            top: e.shiftKey ? -step : step,
            behavior: "smooth",
          });
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, error]);

  // ---------- 章节内链接拦截 ----------

  useEffect(() => {
    if (loading) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      // 穿透 Shadow DOM 查找 <a>
      const composedPath = e.composedPath();
      const anchor = composedPath.find(
        (el) => el instanceof HTMLAnchorElement
      ) as HTMLAnchorElement | undefined;
      if (!anchor) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      // 外部链接：不拦截
      if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) return;

      e.preventDefault();
      e.stopPropagation();

      const book = bookRef.current;
      if (!book?.resolveHref) return;

      // 通过 composedPath 找到来源 section，用 section.resolveHref 解析相对路径
      let href = rawHref;
      const hostDiv = composedPath.find(
        (el) => el instanceof HTMLElement && (el as HTMLElement).dataset.sectionIndex != null
      ) as HTMLElement | undefined;
      if (hostDiv) {
        const si = Number(hostDiv.dataset.sectionIndex);
        const section = book.sections[si];
        if (section?.resolveHref) {
          href = section.resolveHref(rawHref);
        }
      }

      // 内部链接：解析并滚动
      const resolved = book.resolveHref(href);
      if (!resolved) return;

      // 尝试锚点精确定位
      const fragment = extractFragment(rawHref);
      if (fragment && scrollToAnchorInSection(shadowRoots.current, resolved.index, fragment)) {
        return;
      }
      const el = sectionEls.current.get(resolved.index);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // 在 capture 阶段监听，确保能捕获 Shadow DOM 内的点击
    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, [loading]);

  // ---------- 渲染 ----------

  return (
    <div
      ref={containerRef}
      className="reader-scroll relative h-full overflow-y-auto bg-background"
    >
      {showSpinner && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" role="status">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="text-sm text-destructive">加载失败：{error}</div>
        </div>
      )}
      {/* 章节内容容器 */}
      <div
        ref={contentRef}
        className={`mx-auto max-w-3xl py-8 transition-opacity duration-150 ${loading ? "opacity-0" : "opacity-100"}`}
      >
        {/* 章节宿主 div 通过 DOM API 动态插入 */}
      </div>
      {/* 底部留白：允许最后一章内容滚到视口中间 */}
      <div className="h-[40vh]" aria-hidden="true" />
    </div>
  );
});

/* ---------- 辅助：在 TOC 树中查找匹配 section id 的项 ---------- */

function findTocItem(
  toc: FoliateTocItem[],
  sectionId: string
): { label: string; href: string } | undefined {
  for (const item of toc) {
    // TOC href 可能包含 fragment（如 "ch01.xhtml#sec1"），取路径部分比较
    const hrefPath = item.href.split("#")[0];
    if (sectionId === hrefPath || sectionId.endsWith("/" + hrefPath)) {
      return { label: item.label, href: item.href };
    }
    if (item.subitems) {
      const found = findTocItem(item.subitems, sectionId);
      if (found) return found;
    }
  }
  return undefined;
}
