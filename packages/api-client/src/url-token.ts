/** Reads `token` from the URL fragment (#token=...), which is never sent to servers. */
export function tokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('token');
}
