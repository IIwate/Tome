/**
 * foliate-js 封装层
 * 封装 EPUB 阅读器的核心操作：创建视图、打开书籍、样式注入、导航
 */

// 注册 <foliate-view> 自定义元素
import "foliate-js/view.js";

/* ---------- 类型定义 ---------- */

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}

export interface FoliateLocation {
  fraction: number;
  cfi: string;
  tocItem?: { label: string; href: string; id?: number };
  pageItem?: { label: string };
  range?: Range;
  index?: number;
}

export interface FoliateBook {
  toc: FoliateTocItem[];
  metadata: {
    title?: string;
    language?: string[];
    identifier?: string;
  };
  sections: { id: string; cfi?: string; linear?: string }[];
  rendition?: { layout?: string };
}

export interface FoliateRenderer extends HTMLElement {
  getContents(): { doc: Document; index: number }[];
  goTo(target: unknown): Promise<void>;
}

export interface FoliateView extends HTMLElement {
  open(book: File | Blob | string): Promise<void>;
  init(opts: {
    lastLocation?: string;
    showTextStart?: boolean;
  }): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(frac: number): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation: FoliateLocation | null;
}

/* ---------- 核心函数 ---------- */

/** 创建 foliate-view 实例 */
export function createView(): FoliateView {
  return document.createElement("foliate-view") as FoliateView;
}

/**
 * 从字节数组打开 EPUB。
 * onLoad 使用 ref 回调模式：传入一个返回当前回调的 getter，
 * 避免闭包过期导致设置变更后新章节仍用旧样式。
 */
export async function openEpub(
  view: FoliateView,
  fileBytes: Uint8Array,
  opts?: {
    lastLocation?: string;
    onRelocate?: (location: FoliateLocation) => void;
    getOnLoad?: () => (detail: { doc: Document; index: number }) => void;
  }
): Promise<void> {
  const blob = new File([fileBytes], "book.epub", {
    type: "application/epub+zip",
  });
  await view.open(blob);

  // 配置滚动模式
  view.renderer.setAttribute("flow", "scrolled");
  view.renderer.setAttribute("max-inline-size", "768px");

  // 注册事件
  if (opts?.onRelocate) {
    view.addEventListener("relocate", ((e: CustomEvent<FoliateLocation>) => {
      opts.onRelocate!(e.detail);
    }) as EventListener);
  }

  if (opts?.getOnLoad) {
    view.addEventListener("load", ((
      e: CustomEvent<{ doc: Document; index: number }>
    ) => {
      // 每次调用 getter 获取最新回调，避免闭包过期
      opts.getOnLoad!()(e.detail);
    }) as EventListener);
  }

  // 初始化位置
  await view.init({
    lastLocation: opts?.lastLocation,
    showTextStart: !opts?.lastLocation,
  });
}

const INJECT_ATTR = "data-reader-inject";

/** 注入阅读样式到 EPUB section 文档 */
export function injectStyles(
  doc: Document,
  styles: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    color: string;
    background: string;
  }
): void {
  // 移除旧的注入样式
  doc.querySelectorAll(`style[${INJECT_ATTR}]`).forEach((el) => el.remove());

  const css = `
    html, body {
      color: ${styles.color} !important;
      background: ${styles.background} !important;
    }
    body, p, div, span, li, td, th, blockquote, cite, pre, code {
      font-family: ${styles.fontFamily}, system-ui, sans-serif !important;
      font-size: ${styles.fontSize}px !important;
      line-height: ${styles.lineHeight} !important;
    }
    img, svg, video, canvas {
      max-width: 100% !important;
      height: auto !important;
    }
    script { display: none !important; }
  `;
  const style = doc.createElement("style");
  style.setAttribute(INJECT_ATTR, "");
  style.textContent = css;
  doc.head.appendChild(style);

  // 移除内联事件处理器（安全加固）
  doc.querySelectorAll("[onclick],[onload],[onerror]").forEach((el) => {
    el.removeAttribute("onclick");
    el.removeAttribute("onload");
    el.removeAttribute("onerror");
  });

  // 移除 script 标签
  doc.querySelectorAll("script").forEach((el) => el.remove());
}

/** 关闭并清理视图 */
export function closeView(view: FoliateView): void {
  view.close();
  view.remove();
}
