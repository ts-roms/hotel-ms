import { Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { type ReactNode } from 'react';

/**
 * Card frame for the sections of the employee's file beyond the profile (ADR-0028):
 * employment type and emergency contact, pay history, trainings and certifications,
 * performance reviews.
 */
export function RecordSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}
