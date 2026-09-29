'use client';

import * as React from 'react';

/**
 * Thin indeterminate bar at the top of the viewport while `busy`. Shown only after a
 * short delay so fast responses do not flicker it.
 */
export function TopProgress({ busy, delayMs = 150 }: { busy: boolean; delayMs?: number }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [busy, delayMs]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="h-full w-full origin-left animate-progress bg-linear-to-r from-primary via-info to-primary" />
    </div>
  );
}
