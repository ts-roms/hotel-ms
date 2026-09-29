import { formatDateTime } from '@hotel/format';

export const when = (iso: string | null) => (iso ? formatDateTime(iso) : '—');
