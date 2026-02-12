import { useEffect } from "react";
import { useSettingsStore, type Theme } from "@/stores/settings";
import { cn } from "@/lib/utils";
import { X, Sun, Moon, BookOpen } from "lucide-react";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
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

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const theme = useSettingsStore((s) => s.theme);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const margin = useSettingsStore((s) => s.margin);

  const setTheme = useSettingsStore((s) => s.setTheme);
  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setLineHeight = useSettingsStore((s) => s.setLineHeight);
  const setMargin = useSettingsStore((s) => s.setMargin);

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
          <h3 className="text-sm font-semibold text-foreground">排版设置</h3>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-lg p-1 text-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
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
                  onClick={() => setTheme(value)}
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
                  onClick={() => setFontFamily(opt.value)}
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
            onChange={setFontSize}
          />

          {/* 行高 */}
          <RangeSlider
            label="行高"
            value={lineHeight}
            min={1.4}
            max={2.4}
            step={0.2}
            displayValue={lineHeight.toFixed(1)}
            onChange={setLineHeight}
          />

          {/* 边距 */}
          <RangeSlider
            label="边距"
            value={margin}
            min={40}
            max={120}
            step={20}
            displayValue={`${margin}px`}
            onChange={setMargin}
          />
        </div>
      </div>
    </>
  );
}
