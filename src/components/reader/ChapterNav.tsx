import { useCallback } from "react";
import { X } from "lucide-react";
import type { FoliateTocItem } from "@/lib/foliate";

interface ChapterNavProps {
  toc: FoliateTocItem[];
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

function TocItem({
  item,
  depth,
  onNavigate,
}: {
  item: FoliateTocItem;
  depth: number;
  onNavigate: (href: string) => void;
}) {
  const handleClick = useCallback(() => {
    onNavigate(item.href);
  }, [item.href, onNavigate]);

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full text-left px-4 py-2 text-sm text-foreground/80 hover:bg-accent hover:text-foreground transition-colors truncate"
        style={{ paddingLeft: `${16 + depth * 16}px` }}
        title={item.label}
      >
        {item.label}
      </button>
      {item.subitems?.map((sub, i) => (
        <TocItem
          key={`${sub.href}-${i}`}
          item={sub}
          depth={depth + 1}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

export function ChapterNav({ toc, open, onClose, onNavigate }: ChapterNavProps) {
  if (!open) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />
      {/* 侧边面板 */}
      <div className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border/50 bg-card/80 shadow-2xl backdrop-blur-xl animate-in slide-in-from-left duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">目录</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-foreground/60 hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 章节列表 */}
        <div className="reader-scroll flex-1 overflow-y-auto py-1">
          {toc.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              此书无目录信息
            </p>
          ) : (
            toc.map((item, i) => (
              <TocItem
                key={`${item.href}-${i}`}
                item={item}
                depth={0}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
