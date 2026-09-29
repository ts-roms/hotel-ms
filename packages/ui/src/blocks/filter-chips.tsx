'use client';

import * as React from 'react';

import { Toggle } from '../components/toggle.js';
import { cn } from '../lib/utils.js';

const chipTones = {
  primary:
    'data-[state=on]:shadow-sm data-[state=on]:hover:bg-primary/10 data-[state=on]:hover:text-primary',
  /** "On" marks something switched off or excluded (e.g. sold out). */
  destructive:
    'data-[state=on]:border-destructive/30 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive data-[state=on]:hover:bg-destructive/10 data-[state=on]:hover:text-destructive',
};

/** A pill-shaped toggle for filtering a list or showing/hiding a category. */
export function FilterChip({
  pressed,
  onPressedChange,
  tone = 'primary',
  disabled,
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  tone?: keyof typeof chipTones;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      pressed={pressed}
      disabled={disabled}
      onPressedChange={onPressedChange}
      className={cn(
        'rounded-full px-3 active:scale-95 disabled:opacity-60 data-[state=off]:text-muted-foreground data-[state=off]:hover:border-ring/40 data-[state=off]:hover:text-foreground',
        chipTones[tone],
        className,
      )}
    >
      {children}
    </Toggle>
  );
}

/** A labelled, wrapping row of {@link FilterChip}s. */
export function ChipGroup({
  label,
  className,
  children,
}: {
  /** Accessible name of the group. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  );
}

/** One-of-several choice drawn as a segmented button bar (e.g. Active / Done). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the control. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex rounded-lg border bg-card p-0.5', className)}
    >
      {options.map((o) => (
        <Toggle
          key={o.value}
          size="sm"
          pressed={value === o.value}
          onPressedChange={() => onChange(o.value)}
          className="px-3 hover:bg-transparent hover:text-foreground active:scale-100 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
        >
          {o.label}
        </Toggle>
      ))}
    </div>
  );
}
