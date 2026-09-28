import { Card, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import type { ReactNode } from 'react';

/** Section card with an icon badge in the title. */
export function Section({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className={children ? 'pb-4' : undefined}>
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4">
            {icon}
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription className="pl-12">{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}
