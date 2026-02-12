/**
 * foliate-js 封装层
 * 封装 EPUB 阅读器的核心操作：创建视图、打开书籍、样式注入、导航
 */

// 注册 <foliate-view> 自定义元素
import "foliate-js/view.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — makeBook 是 foliate-js 内部导出，无类型声明
import { makeBook } from "foliate-js/view.js";

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

/** EPUB section（spine 条目），带加载/卸载方法 */
export interface EpubSection {
  id: string;
  /** 加载并返回 blob URL（所有资源已解析为 blob URL） */
  load: () => Promise<string>;
  /** 释放 blob URL（引用计数，递归释放子资源） */
  unload: () => void;
  /** 返回原始 DOM（资源未解析，不含 blob URL） */
  createDocument: () => Promise<Document>;
  /** 将相对 href 解析为 EPUB 内部绝对路径 */
  resolveHref?: (href: string) => string;
  size: number;
  cfi?: string;
  linear?: string;
}

/** makeBook() 返回的完整 EPUB 对象 */
export interface ParsedEpub {
  metadata: {
    title?: string;
    language?: string[] | string;
    identifier?: string;
  };
  rendition?: { layout?: string };
  sections: EpubSection[];
  toc?: FoliateTocItem[];
  dir?: string;
  resolveHref?: (
    href: string
  ) => { index: number; anchor?: (doc: Document) => Element | Range } | null;
  destroy?: () => void;
}

export interface FoliateRenderer extends HTMLElement {
  getContents(): { doc: Document; index: number }[];
  goTo(target: unknown): Promise<void>;
  /** 当前滚动偏移量 */
  readonly start: number;
  /** 当前滚动偏移量 + 视口尺寸 */
  readonly end: number;
  /** 内容总尺寸（scrolled 模式下为内容高度） */
  readonly viewSize: number;
  /** 视口尺寸 */
  readonly size: number;
  /** 是否在首章且无法再向前 */
  readonly atStart: boolean;
  /** 是否在末章且无法再向后 */
  readonly atEnd: boolean;
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
    margin: number;
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
    body {
      padding-left: ${styles.margin}px !important;
      padding-right: ${styles.margin}px !important;
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

/* ---------- 连续滚动模式 API ---------- */

/**
 * 仅解析 EPUB，不创建渲染器。
 * 返回 book 对象，用于连续滚动模式中按 section 加载内容。
 */
export async function parseEpub(fileBytes: Uint8Array): Promise<ParsedEpub> {
  const file = new File([fileBytes], "book.epub", {
    type: "application/epub+zip",
  });
  return (await makeBook(file)) as ParsedEpub;
}

/**
 * 加载 EPUB section 内容为 HTML 字符串。
 * section.load() 返回 blob URL（资源已解析），fetch 获取完整 HTML。
 */
export async function fetchSectionHtml(
  section: EpubSection
): Promise<string> {
  const blobUrl = await section.load();
  if (!blobUrl) return "";
  const resp = await fetch(blobUrl);
  return resp.text();
}

/** 向 Shadow DOM 注入阅读排版样式 */
export function injectShadowStyles(
  shadow: ShadowRoot,
  styles: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    margin: number;
    color: string;
    background: string;
  }
): void {
  shadow.querySelectorAll(`style[${INJECT_ATTR}]`).forEach((el) => el.remove());

  const css = `
    :host { display: block; }
    html, body {
      color: ${styles.color} !important;
      background: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    body {
      padding-left: ${styles.margin}px !important;
      padding-right: ${styles.margin}px !important;
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
  const el = document.createElement("style");
  el.setAttribute(INJECT_ATTR, "");
  el.textContent = css;
  shadow.prepend(el);
}
