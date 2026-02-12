import { TitleBar } from "./TitleBar";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
