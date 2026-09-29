import type { PunchType } from '@hotel/contracts';
import { type MessageKey } from '@/lib/i18n';

export const PUNCH_LABEL: Record<PunchType, MessageKey> = {
  IN: 'hr.clockIn',
  OUT: 'hr.clockOut',
  BREAK_START: 'hr.breakStart',
  BREAK_END: 'hr.breakEnd',
};
