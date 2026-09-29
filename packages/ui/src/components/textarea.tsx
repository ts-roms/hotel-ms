import * as React from 'react';

import { cn } from '../lib/utils.js';
import { fieldClasses } from './input.js';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClasses, 'h-auto min-h-20 resize-y', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
