import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { logError } from "@/lib/logger";

interface ReaderErrorPanelProps {
  message: string;
  onBack: () => void;
  title?: string;
}

interface ReaderErrorBoundaryProps {
  children: ReactNode;
  onBack: () => void;
  resetKeys?: unknown[];
}

interface ReaderErrorBoundaryState {
  error: Error | null;
}

export function ReaderErrorPanel({
  message,
  onBack,
  title = "打开书籍失败",
}: ReaderErrorPanelProps) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button
          onClick={onBack}
          className="mt-4 inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          返回书架
        </button>
      </div>
    </div>
  );
}

export class ReaderErrorBoundary extends Component<
  ReaderErrorBoundaryProps,
  ReaderErrorBoundaryState
> {
  state: ReaderErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ReaderErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError("reader/ReaderErrorBoundary", "阅读器渲染异常", {
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: ReaderErrorBoundaryProps) {
    if (haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ReaderErrorPanel
          message={this.state.error.message || "阅读器渲染失败，请返回书架后重试。"}
          onBack={this.props.onBack}
        />
      );
    }

    return this.props.children;
  }
}

function haveResetKeysChanged(
  prevResetKeys: unknown[] | undefined,
  nextResetKeys: unknown[] | undefined
): boolean {
  if (prevResetKeys === nextResetKeys) return false;
  if (!prevResetKeys || !nextResetKeys) return true;
  if (prevResetKeys.length !== nextResetKeys.length) return true;

  for (let i = 0; i < prevResetKeys.length; i++) {
    if (!Object.is(prevResetKeys[i], nextResetKeys[i])) {
      return true;
    }
  }

  return false;
}
