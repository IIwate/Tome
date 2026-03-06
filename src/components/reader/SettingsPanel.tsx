import { useEffect } from "react";
import type { BookConfig, Theme, ViewSettings } from "@/lib/book-config";
import { cn } from "@/lib/utils";
import { X, Sun, Moon, BookOpen } from "lucide-react";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  config: BookConfig;
  onChangeViewSettings: (patch: Partial<ViewSettings>) => void;
  onResetViewSettings: () => void;
  hasOverrides: boolean;
}

const FONT_OPTIONS = [
  { value: "system-ui", label: "系统默认" },
  { value: '"SimSun", "宋体", serif', label: "宋体" },
  { value: '"KaiTi", "楷体", serif', label: "楷体" },
  { value: '"SimHei", "黑体", sans-serif', label: "黑体" },
];

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "sepia", label: "护眼", icon: BookOpen },
];

/** 将浮点值归一化到最近的步进值 */
function snapToStep(value: number, min: number, step: number): number {
  return Math.round((value - min) / step) * step + min;
}

function RangeSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}) {
  const id = `settings-${label}`;
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <span className="text-xs font-medium tabular-nums text-foreground">
          {displayValue}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(snapToStep(Number(e.target.value), min, step))}
        className="settings-slider w-full"
        style={{
          background: `linear-gradient(to right, hsl(var(--primary) / 0.5) ${percent}%, hsl(var(--muted)) ${percent}%)`,
        }}
      />
    </div>
  );
}

export function SettingsPanel({
  open,
  onClose,
  config,
  onChangeViewSettings,
  onResetViewSettings,
  hasOverrides,
}: SettingsPanelProps) {
  const { theme, fontFamily, fontSize, lineHeight, margin } =
    config.viewSettings;

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />
      {/* 右侧面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="排版设置"
        className="fixed right-0 top-0 z-50 flex h-full w-72 flex-col border-l border-border/50 bg-card/80 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-200"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">排版设置</h3>
            <p className="text-[11px] text-muted-foreground">仅作用于当前书籍</p>
          </div>
          <div className="flex items-center gap-2">
            {hasOverrides && (
              <button
                type="button"
                onClick={onResetViewSettings}
                className="rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                恢复默认
              </button>
            )}
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-lg p-1 text-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </div>

        {/* 设置内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* 主题 */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">主题</span>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onChangeViewSettings({ theme: value })}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                    theme === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 字体 */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-foreground">字体</span>
            <div className="grid grid-cols-2 gap-1.5">
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChangeViewSettings({ fontFamily: opt.value })}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-medium transition-all",
                    fontFamily === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                  style={{ fontFamily: `${opt.value}, system-ui` }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 字号 */}
          <RangeSlider
            label="字号"
            value={fontSize}
            min={14}
            max={32}
            step={2}
            displayValue={`${fontSize}px`}
            onChange={(value) => onChangeViewSettings({ fontSize: value })}
          />

          {/* 行高 */}
          <RangeSlider
            label="行高"
            value={lineHeight}
            min={1.4}
            max={2.4}
            step={0.2}
            displayValue={lineHeight.toFixed(1)}
            onChange={(value) => onChangeViewSettings({ lineHeight: value })}
          />

          {/* 边距 */}
          <RangeSlider
            label="边距"
            value={margin}
            min={40}
            max={120}
            step={20}
            displayValue={`${margin}px`}
            onChange={(value) => onChangeViewSettings({ margin: value })}
          />
        </div>
      </div>
    </>
  );
}
