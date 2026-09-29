import { describe, expect, it } from 'vitest';
import { SMS_MAX_LENGTH, toSmsMessage } from './sms.js';

describe('toSmsMessage', () => {
  it('normalizes a formatted E.164 number', () => {
    expect(toSmsMessage('+63 (917) 123-4567', 'Hi')).toEqual({ to: '+639171234567', text: 'Hi' });
  });

  it('skips numbers that are missing, national or malformed', () => {
    expect(toSmsMessage(null, 'Hi')).toBeNull();
    expect(toSmsMessage(undefined, 'Hi')).toBeNull();
    expect(toSmsMessage('', 'Hi')).toBeNull();
    expect(toSmsMessage('09171234567', 'Hi')).toBeNull();
    expect(toSmsMessage('+0171234567', 'Hi')).toBeNull();
    expect(toSmsMessage('+1234567', 'Hi')).toBeNull();
    expect(toSmsMessage('+1234567890123456', 'Hi')).toBeNull();
    expect(toSmsMessage('+63 917 abc 4567', 'Hi')).toBeNull();
  });

  it('cuts the text to two segments', () => {
    const message = toSmsMessage('+639171234567', 'x'.repeat(400));
    expect(message?.text).toHaveLength(SMS_MAX_LENGTH);
    expect(SMS_MAX_LENGTH).toBe(320);
  });
});
