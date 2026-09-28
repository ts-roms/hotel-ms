import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { SmsJob } from '@hotel/contracts';
import type { Logger } from 'pino';

/** SMS delivery adapter (spec §56): the worker never depends on one provider. */
export interface SmsTransport {
  readonly name: string;
  send(to: string, text: string): Promise<{ messageId: string }>;
}

/** Development: appends each message to MAIL_DIR/sms.log. */
export class FileSmsTransport implements SmsTransport {
  readonly name = 'file';
  constructor(private readonly dir: string) {}

  async send(to: string, text: string): Promise<{ messageId: string }> {
    await mkdir(this.dir, { recursive: true });
    const messageId = new Date().toISOString();
    await appendFile(path.join(this.dir, 'sms.log'), `${messageId}\t${to}\t${text}\n`, 'utf8');
    return { messageId };
  }
}

/** Amazon SNS direct-to-phone SMS (transactional). Credentials from the task role. */
export class SnsSmsTransport implements SmsTransport {
  readonly name = 'sns';
  constructor(
    private readonly client: Pick<SNSClient, 'send'>,
    private readonly senderId?: string,
  ) {}

  async send(to: string, text: string): Promise<{ messageId: string }> {
    const result = await this.client.send(
      new PublishCommand({
        PhoneNumber: to,
        Message: text,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
          ...(this.senderId
            ? { 'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: this.senderId } }
            : {}),
        },
      }),
    );
    return { messageId: result.MessageId ?? 'unknown' };
  }
}

export class MemorySmsTransport implements SmsTransport {
  readonly name = 'memory';
  readonly sent: { to: string; text: string }[] = [];
  async send(to: string, text: string): Promise<{ messageId: string }> {
    this.sent.push({ to, text });
    return { messageId: String(this.sent.length) };
  }
}

export function createSmsTransport(env: {
  NODE_ENV: string;
  SMS_TRANSPORT: 'file' | 'sns';
  MAIL_DIR: string;
  AWS_REGION?: string | undefined;
  SMS_SENDER_ID?: string | undefined;
}): SmsTransport {
  if (env.SMS_TRANSPORT === 'sns') {
    return new SnsSmsTransport(
      new SNSClient(env.AWS_REGION ? { region: env.AWS_REGION } : {}),
      env.SMS_SENDER_ID,
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SMS_TRANSPORT=file is for development only');
  }
  return new FileSmsTransport(env.MAIL_DIR);
}

/** Never logs the text or the full number (personal data). */
export async function deliverSms(job: SmsJob, transport: SmsTransport, log: Logger): Promise<void> {
  const { messageId } = await transport.send(job.to, job.text);
  log.info(
    {
      transport: transport.name,
      messageId,
      to: `…${job.to.slice(-4)}`,
      correlationId: job.correlationId,
    },
    'sms sent',
  );
}
