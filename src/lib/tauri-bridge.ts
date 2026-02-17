import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type OpenDialog = typeof open;
type InvokeCommand = typeof invoke;

export interface TomeTauriMocks {
  open?: OpenDialog;
  invoke?: InvokeCommand;
}

declare global {
  interface Window {
    __TOME_MOCKS__?: TomeTauriMocks;
  }
}

function getMocks(): TomeTauriMocks | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__TOME_MOCKS__;
}

export async function openDialog(
  options?: Parameters<OpenDialog>[0]
): Promise<string | string[] | null> {
  const mock = getMocks()?.open;
  if (mock) return mock(options as never) as Promise<string | string[] | null>;
  return open(options as never) as Promise<string | string[] | null>;
}

export async function invokeCommand<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const mock = getMocks()?.invoke;
  if (mock) {
    return (await mock(cmd, args as never)) as T;
  }
  return invoke<T>(cmd, args);
}
