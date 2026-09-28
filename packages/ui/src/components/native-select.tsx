import * as React from 'react';

import { cn } from '../lib/utils.js';
import { fieldClasses } from './input.js';

/** Native select styled like Input: accessible and mobile-friendly by default. */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClasses, 'cursor-pointer pr-8', className)} {...props} />
));
NativeSelect.displayName = 'NativeSelect';
