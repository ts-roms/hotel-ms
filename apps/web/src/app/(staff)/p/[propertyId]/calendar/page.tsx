'use client';

import { Suspense } from 'react';
import { UnifiedCalendar } from './_components/unified-calendar';

/**
 * The property's unified calendar (spec §38–39, ADR-0026): arrivals, departures, shifts,
 * leave, birthdays, events and out-of-order rooms, each as far as the user may see them.
 * Managers schedule events here and invite staff.
 */
export default function CalendarPage() {
  return (
    <Suspense>
      <UnifiedCalendar />
    </Suspense>
  );
}
