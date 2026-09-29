/** Termination date + N months (clamped to the month's last day), as YYYY-MM-DD. */
export function purgeOn(terminatedOn: Date | null, months: number | null): string | null {
  if (!terminatedOn || months === null) return null;
  const y = terminatedOn.getUTCFullYear();
  const m = terminatedOn.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(terminatedOn.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}
