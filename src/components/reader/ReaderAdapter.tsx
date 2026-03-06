import { forwardRef, useImperativeHandle, useRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { EpubScrollView, type EpubScrollViewHandle } from "./EpubScrollView";
import { PdfReaderView, type PdfReaderViewHandle } from "./PdfReaderView";
import { TxtReaderView, type TxtReaderViewHandle } from "./TxtReaderView";
import type { BookConfig } from "@/lib/book-config";
import type { BookDocFormat, BookDocTocItem } from "@/lib/book-doc";

export interface ReaderAdapterHandle {
  navigateTo: (target: string) => Promise<void>;
}

export interface ReaderAdapterProps {
  filePath: string;
  lastPosition?: string | null;
  config: BookConfig;
  onRelocate?: (position: string | null, percent: number) => void;
  onTocLoaded?: (toc: BookDocTocItem[]) => void;
  onError?: (error: Error) => void;
}

export type ReaderAdapterComponent = ForwardRefExoticComponent<
  ReaderAdapterProps & RefAttributes<ReaderAdapterHandle>
>;

const EpubReaderAdapter = forwardRef<ReaderAdapterHandle, ReaderAdapterProps>(
  function EpubReaderAdapter(props, ref) {
    const innerRef = useRef<EpubScrollViewHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        navigateTo: async (target: string) => {
          await innerRef.current?.goTo(target);
        },
      }),
      []
    );

    return <EpubScrollView ref={innerRef} {...props} />;
  }
);

const PdfReaderAdapter = forwardRef<ReaderAdapterHandle, ReaderAdapterProps>(
  function PdfReaderAdapter({ onTocLoaded, ...props }, ref) {
    const innerRef = useRef<PdfReaderViewHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        navigateTo: async (target: string) => {
          const pageIndex = Number.parseInt(target, 10);
          if (!Number.isNaN(pageIndex)) {
            innerRef.current?.goToPage(pageIndex);
          }
        },
      }),
      []
    );

    return <PdfReaderView ref={innerRef} {...props} onChaptersLoaded={onTocLoaded} />;
  }
);

const TxtReaderAdapter = forwardRef<ReaderAdapterHandle, ReaderAdapterProps>(
  function TxtReaderAdapter({ onTocLoaded, ...props }, ref) {
    const innerRef = useRef<TxtReaderViewHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        navigateTo: async (target: string) => {
          const offset = Number.parseInt(target, 10);
          if (!Number.isNaN(offset)) {
            innerRef.current?.scrollToOffset(offset);
          }
        },
      }),
      []
    );

    return <TxtReaderView ref={innerRef} {...props} onChaptersLoaded={onTocLoaded} />;
  }
);

const READER_ADAPTERS: Record<BookDocFormat, ReaderAdapterComponent> = {
  epub: EpubReaderAdapter,
  pdf: PdfReaderAdapter,
  txt: TxtReaderAdapter,
};

export function getReaderAdapterComponent(format: BookDocFormat): ReaderAdapterComponent {
  return READER_ADAPTERS[format];
}
