'use client';

import * as React from 'react';

type FormatTitle = (page: string) => string;

const FormatContext = React.createContext<FormatTitle>((page) => page);

/**
 * How page titles become the browser tab title, e.g. "Rooms" → "Rooms · Hotel Platform". Each
 * app provides it once near the root; without it the page title is used as is.
 */
export function DocumentTitleProvider({
  format,
  children,
}: {
  format: FormatTitle;
  children: React.ReactNode;
}) {
  return <FormatContext value={format}>{children}</FormatContext>;
}

/**
 * Sets the document title while the calling component is mounted (WCAG 2.4.2 Page Titled), and
 * restores the previous one after. Pages here are client components, so the Metadata API
 * cannot title them. Nothing happens while `title` is empty (e.g. still loading).
 */
export function useDocumentTitle(title: string | undefined | null): void {
  const format = React.useContext(FormatContext);
  const full = title ? format(title) : undefined;
  React.useEffect(() => {
    if (!full) return;
    const previous = document.title;
    document.title = full;
    return () => {
      document.title = previous;
    };
  }, [full]);
}

/** `useDocumentTitle` as an element, for server components and pages without a PageHeader. */
export function DocumentTitle({ title }: { title: string | undefined | null }) {
  useDocumentTitle(title);
  return null;
}
