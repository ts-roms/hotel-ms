import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { RenderedEmail } from './templates.js';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  from: string;
}

/** Delivery adapter (blueprint §56): the worker never depends on one provider. */
export interface EmailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

/**
 * Development only: writes each email to MAIL_DIR as a .eml-like text file, so links
 * (password reset, invitations) can be opened locally without a mail server.
 */
export class FileTransport implements EmailTransport {
  readonly name = 'file';
  constructor(private readonly dir: string) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    await mkdir(this.dir, { recursive: true });
    const messageId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${email.to.replace(/[^a-z0-9]/gi, '_')}`;
    const content = `From: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}`;
    await writeFile(path.join(this.dir, `${messageId}.txt`), content, 'utf8');
    return { messageId };
  }
}

/** Amazon SES v2. Credentials come from the task role (no keys in configuration). */
export class SesTransport implements EmailTransport {
  readonly name = 'ses';
  constructor(
    private readonly client: Pick<SESv2Client, 'send'>,
    private readonly configurationSet?: string,
  ) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: email.from,
        Destination: { ToAddresses: [email.to] },
        ...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: email.text, Charset: 'UTF-8' },
              Html: { Data: email.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    return { messageId: result.MessageId ?? 'unknown' };
  }
}

/** Test double. */
export class MemoryTransport implements EmailTransport {
  readonly name = 'memory';
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    this.sent.push(email);
    return { messageId: String(this.sent.length) };
  }
}

export function createTransport(env: {
  NODE_ENV: string;
  EMAIL_TRANSPORT: 'file' | 'ses';
  MAIL_DIR: string;
  AWS_REGION?: string | undefined;
  SES_CONFIGURATION_SET?: string | undefined;
}): EmailTransport {
  if (env.EMAIL_TRANSPORT === 'ses') {
    return new SesTransport(
      new SESv2Client(env.AWS_REGION ? { region: env.AWS_REGION } : {}),
      env.SES_CONFIGURATION_SET,
    );
  }
  if (env.NODE_ENV === 'production') {
    // File delivery writes reset links to disk; never acceptable outside development.
    throw new Error('EMAIL_TRANSPORT=file is not allowed in production');
  }
  return new FileTransport(env.MAIL_DIR);
}
