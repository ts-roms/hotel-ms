'use client';

import * as React from 'react';

import { Toggle } from '../components/toggle.js';
import { cn } from '../lib/utils.js';

/** Monday first; values are 0 = Sunday … 6 = Saturday, as `Date#getDay()`. */
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** Short weekday name (0 = Sunday) in the user's locale. 2023-01-01 was a Sunday. */
export function weekdayShortName(day: number): string {
  return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleString([], {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

/** Multi-select of weekdays (e.g. which days a recurring shift repeats on). */
export function WeekdayPicker({
  value,
  onChange,
  label,
  dayLabel = weekdayShortName,
  days = WEEKDAYS_MONDAY_FIRST,
  className,
}: {
  /** Selected days, 0 = Sunday … 6 = Saturday. */
  value: number[];
  onChange: (days: number[]) => void;
  /** Accessible name of the group. */
  label: string;
  dayLabel?: (day: number) => React.ReactNode;
  /** Days in display order. */
  days?: readonly number[];
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1', className)}>
      {days.map((d) => {
        const on = value.includes(d);
        return (
          <Toggle
            key={d}
            variant="outline"
            size="sm"
            pressed={on}
            onPressedChange={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
            className="h-7 rounded-md px-2 font-normal data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90"
          >
            {dayLabel(d)}
          </Toggle>
        );
      })}
    </div>
  );
}
