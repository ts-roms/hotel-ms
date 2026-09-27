'use client';

import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * Thin indeterminate bar at the top of the viewport while any request is in flight.
 * Shown only after a short delay so fast responses do not flicker it.
 */
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, [busy]);

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
