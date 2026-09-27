import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { deliverEmail } from './deliver.js';
import { renderEmail } from './templates.js';
import { createTransport, MemoryTransport, SesTransport } from './transports.js';

const log = pino({ level: 'silent' });

describe('email templates', () => {
  it('include the action link in text and HTML, escaping HTML', () => {
    const email = renderEmail({
      template: 'member-invitation',
      data: {
        displayName: 'Nina <script>',
        organizationName: 'ABC & Co',
        inviterName: 'Ana',
        acceptUrl: 'https://app.example/accept-invitation#token=abc',
        expiresInDays: 7,
      },
    });
    expect(email.subject).toBe("You're invited to ABC & Co");
    expect(email.text).toContain('https://app.example/accept-invitation#token=abc');
    expect(email.html).toContain('href="https://app.example/accept-invitation#token=abc"');
    expect(email.html).toContain('Nina &lt;script&gt;');
    expect(email.html).not.toContain('<script>');
  });
});

describe('delivery', () => {
  it('renders and sends through the transport', async () => {
    const transport = new MemoryTransport();
    await deliverEmail(
      {
        template: 'password-changed',
        data: { displayName: 'John' },
        to: 'john@abc.test',
        locale: 'en',
        correlationId: 'req-1',
      },
      transport,
      'Hotel <no-reply@example.com>',
      log,
    );
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: 'john@abc.test',
      subject: 'Your password was changed',
    });
  });

  it('maps to an SES v2 SendEmail request', async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: 'ses-123' });
    const transport = new SesTransport({ send } as never, 'hotel-staging');
    const result = await transport.send({
      to: 'a@b.test',
      from: 'x@y.test',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>',
    });
    expect(result.messageId).toBe('ses-123');
    const command = send.mock.calls[0]![0] as SendEmailCommand;
    expect(command.input).toMatchObject({
      FromEmailAddress: 'x@y.test',
      Destination: { ToAddresses: ['a@b.test'] },
      ConfigurationSetName: 'hotel-staging',
      Content: {
        Simple: {
          Subject: { Data: 'S' },
          Body: { Text: { Data: 'T' }, Html: { Data: '<p>H</p>' } },
        },
      },
    });
  });

  it('refuses file delivery in production', () => {
    expect(() =>
      createTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'file', MAIL_DIR: '.mail' }),
    ).toThrow();
  });
});
