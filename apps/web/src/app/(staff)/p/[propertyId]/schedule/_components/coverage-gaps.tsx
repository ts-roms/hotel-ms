'use client';

import type { CoverageGap } from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import { Alert } from '@hotel/ui';
import { TriangleAlert } from 'lucide-react';
import { t } from '@/lib/i18n';

/** Understaffed windows of the week shown (spec §35, ADR-0028). */
export function CoverageGaps({ gaps }: { gaps: CoverageGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <Alert className="border-warning/40 bg-warning/10 text-foreground">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 text-warning" />
        {t('sched.understaffed')}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm">
        {gaps.map((g) => (
          <li key={`${g.requirementId}:${g.date}`}>
            {formatDate(g.date)} · {g.departmentName} {g.startTime}–{g.endTime}:{' '}
            <strong>
              {g.scheduled} / {g.required}
            </strong>{' '}
            {t('sched.scheduled')}
            {g.published < g.scheduled && (
              <span className="text-muted-foreground">
                {' '}
                ({g.published} {t('sched.publishedShort')})
              </span>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
