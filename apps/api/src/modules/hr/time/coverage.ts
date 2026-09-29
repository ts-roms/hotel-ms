/**
 * The fewest people on shift at any moment of [start, end): shifts are clipped to the
 * window, and the count is taken on every segment between their starts and ends. So a
 * morning and an afternoon shift handing over at 14:00 cover a 06:00–22:00 window.
 */
export function minimumOnShift(
  shifts: { employeeId: string; startsAt: Date; endsAt: Date }[],
  start: Date,
  end: Date,
): number {
  const clipped = shifts
    .map((s) => ({
      employeeId: s.employeeId,
      from: Math.max(s.startsAt.getTime(), start.getTime()),
      to: Math.min(s.endsAt.getTime(), end.getTime()),
    }))
    .filter((s) => s.from < s.to);
  const points = [...new Set([start.getTime(), ...clipped.flatMap((s) => [s.from, s.to])])]
    .filter((p) => p >= start.getTime() && p < end.getTime())
    .sort((a, b) => a - b);
  let fewest = Infinity;
  for (const at of points) {
    const people = new Set(
      clipped.filter((s) => s.from <= at && s.to > at).map((s) => s.employeeId),
    );
    fewest = Math.min(fewest, people.size);
  }
  return fewest === Infinity ? 0 : fewest;
}
