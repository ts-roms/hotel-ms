import { PublishCommand } from '@aws-sdk/client-sns';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createSmsTransport, deliverSms, MemorySmsTransport, SnsSmsTransport } from './sms.js';

const log = pino({ level: 'silent' });

describe('sms', () => {
  it('delivers through the transport', async () => {
    const transport = new MemorySmsTransport();
    await deliverSms({ to: '+639171234567', text: 'Hello', correlationId: null }, transport, log);
    expect(transport.sent).toEqual([{ to: '+639171234567', text: 'Hello' }]);
  });

  it('sends SNS transactional SMS with the sender id', async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: 'm-1' });
    const transport = new SnsSmsTransport({ send }, 'HOTEL');
    expect(await transport.send('+639171234567', 'Hi')).toEqual({ messageId: 'm-1' });
    const command = send.mock.calls[0]![0] as PublishCommand;
    expect(command.input).toMatchObject({
      PhoneNumber: '+639171234567',
      Message: 'Hi',
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { StringValue: 'Transactional' },
        'AWS.SNS.SMS.SenderID': { StringValue: 'HOTEL' },
      },
    });
  });

  it('refuses the file transport in production', () => {
    expect(() =>
      createSmsTransport({ NODE_ENV: 'production', SMS_TRANSPORT: 'file', MAIL_DIR: '.mail' }),
    ).toThrow('development only');
  });
});
