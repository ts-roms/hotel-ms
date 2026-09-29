'use client';

import { SERVICE_DEPARTMENTS } from '@hotel/contracts';
import { NativeSelect, SegmentedControl } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { enumLabel } from '@/lib/status';

/** Active/done toggle and the department filter of the queue. */
export function ServiceRequestFilters({
  status,
  onStatusChange,
  department,
  onDepartmentChange,
}: {
  status: 'ACTIVE' | 'DONE';
  onStatusChange: (status: 'ACTIVE' | 'DONE') => void;
  department: string;
  onDepartmentChange: (department: string) => void;
}) {
  return (
    <>
      <SegmentedControl
        options={[
          { value: 'ACTIVE', label: t('sr.active') },
          { value: 'DONE', label: t('sr.done') },
        ]}
        value={status}
        onChange={onStatusChange}
      />
      <NativeSelect
        className="h-9 w-auto"
        aria-label={t('sr.all')}
        value={department}
        onChange={(e) => onDepartmentChange(e.target.value)}
      >
        <option value="">{t('sr.all')}</option>
        {SERVICE_DEPARTMENTS.map((d) => (
          <option key={d} value={d}>
            {enumLabel('department', d)}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}
