export type LogLevel = "error" | "info";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  detail?: unknown;
  detailText?: string;
}

type Listener = () => void;

const MAX_ENTRIES = 200;

let enabled = false;
let nextId = 1;

let start = 0;
let size = 0;
let errorCount = 0;
const buffer: Array<LogEntry | undefined> = new Array(MAX_ENTRIES);

const listeners = new Set<Listener>();

let version = 0;
let cachedVersion = -1;
let cachedEntries: readonly LogEntry[] = Object.freeze([]);

function commitChange() {
  version++;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // 忽略监听器异常，避免影响业务
    }
  }
}

export function setEnabled(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  commitChange();
}

function isErrorLike(
  value: unknown
): value is { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown } {
  if (value instanceof Error) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.message === "string" || typeof v.stack === "string";
}

function createJsonReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, createJsonReplacer(), 2);
  } catch {
    return String(value);
  }
}

function formatDetailText(detail: unknown, depth = 0): string {
  if (detail === undefined) return "";
  if (detail === null) return "null";

  if (typeof detail === "string") return detail;
  if (
    typeof detail === "number" ||
    typeof detail === "boolean" ||
    typeof detail === "bigint" ||
    typeof detail === "symbol" ||
    typeof detail === "function"
  ) {
    return String(detail);
  }

  if (isErrorLike(detail)) {
    const name =
      typeof detail.name === "string" && detail.name ? detail.name : "Error";
    const message = typeof detail.message === "string" ? detail.message : "";
    const stack = typeof detail.stack === "string" ? detail.stack : "";

    let text = stack || `${name}${message ? `: ${message}` : ""}`;

    const cause = (detail as Record<string, unknown>).cause;
    if (cause !== undefined && depth < 1) {
      const causeText = formatDetailText(cause, depth + 1);
      if (causeText) text += `\nCause: ${causeText}`;
    }

    return text;
  }

  return safeStringify(detail);
}

function pushEntry(
  level: LogLevel,
  source: string,
  message: string,
  detail?: unknown
) {
  const detailText =
    detail === undefined ? undefined : formatDetailText(detail) || undefined;

  const entry: LogEntry = Object.freeze({
    id: nextId++,
    timestamp: Date.now(),
    level,
    source,
    message,
    detail,
    detailText,
  });

  if (size < MAX_ENTRIES) {
    const index = (start + size) % MAX_ENTRIES;
    buffer[index] = entry;
    size++;
  } else {
    const overwritten = buffer[start];
    if (overwritten?.level === "error") errorCount--;
    buffer[start] = entry;
    start = (start + 1) % MAX_ENTRIES;
  }

  if (level === "error") errorCount++;
  commitChange();
}

export function logError(source: string, message: string, detail?: unknown) {
  if (!enabled) return;
  pushEntry("error", source, message, detail);
}

export function logInfo(source: string, message: string, detail?: unknown) {
  if (!enabled) return;
  pushEntry("info", source, message, detail);
}

function buildEntriesSnapshot(): readonly LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 0; i < size; i++) {
    const entry = buffer[(start + i) % MAX_ENTRIES];
    if (entry) entries.push(entry);
  }
  return Object.freeze(entries);
}

export function getEntries(): readonly LogEntry[] {
  if (cachedVersion !== version) {
    cachedEntries = buildEntriesSnapshot();
    cachedVersion = version;
  }
  return cachedEntries;
}

export function getErrorCount(): number {
  return errorCount;
}

function indentLines(text: string, prefix: string): string {
  return text
    .split(/\r?\n/g)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function exportAsText(): string {
  const entries = getEntries();
  return entries
    .map((e) => {
      const time = new Date(e.timestamp).toISOString();
      let text = `${time} [${e.level}] ${e.source}: ${e.message}`;
      if (e.detailText) text += `\n${indentLines(e.detailText, "  ")}`;
      return text;
    })
    .join("\n\n");
}

export function clearEntries(): void {
  if (size === 0 && errorCount === 0) return;
  buffer.fill(undefined);
  start = 0;
  size = 0;
  errorCount = 0;
  commitChange();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const logger = {
  setEnabled,
  logError,
  logInfo,
  getEntries,
  getErrorCount,
  exportAsText,
  clearEntries,
  subscribe,
} as const;
