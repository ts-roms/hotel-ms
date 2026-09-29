/** Longest text sent: two concatenated SMS segments (ADR-0024). */
export const SMS_MAX_LENGTH = 320;

/**
 * The text message to queue (ADR-0024), or null when the number is not E.164 after
 * removing spaces, parentheses and dashes: anything else is skipped, not sent.
 */
export function toSmsMessage(
  to: string | null | undefined,
  text: string,
): { to: string; text: string } | null {
  const number = to?.replace(/[\s()-]/g, '') ?? '';
  if (!/^\+[1-9]\d{7,14}$/.test(number)) return null;
  return { to: number, text: text.slice(0, SMS_MAX_LENGTH) };
}
