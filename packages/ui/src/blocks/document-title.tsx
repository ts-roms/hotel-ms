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
 * The mounted titles, newest last; the newest one is shown. A MutationObserver re-applies it if
 * the framework re-renders the <head> title (the root layout's metadata) after a navigation.
 */
const mounted: { title: string }[] = [];
let baseTitle = '';
let observer: MutationObserver | null = null;

function sync() {
  const top = mounted.at(-1);
  if (top && document.title !== top.title) document.title = top.title;
}

function mount(entry: { title: string }) {
  if (mounted.length === 0) {
    baseTitle = document.title;
    observer = new MutationObserver(sync);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  mounted.push(entry);
  sync();
}

function unmount(entry: { title: string }) {
  mounted.splice(mounted.indexOf(entry), 1);
  if (mounted.length > 0) return sync();
  observer?.disconnect();
  observer = null;
  document.title = baseTitle;
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
    const entry = { title: full };
    mount(entry);
    return () => unmount(entry);
  }, [full]);
}

/** `useDocumentTitle` as an element, for server components and pages without a PageHeader. */
export function DocumentTitle({ title }: { title: string | undefined | null }) {
  useDocumentTitle(title);
  return null;
}
