import type { EmailJob } from '@hotel/contracts';
import type { Logger } from 'pino';
import { renderEmail } from './templates.js';
import type { EmailTransport } from './transports.js';

/**
 * Processes one notifications job. Recipients are logged; bodies are not, because they
 * can contain single-use links.
 */
export async function deliverEmail(
  job: EmailJob,
  transport: EmailTransport,
  from: string,
  log: Logger,
): Promise<string> {
  const rendered = renderEmail(job);
  const { messageId } = await transport.send({ ...rendered, to: job.to, from });
  log.info(
    {
      template: job.template,
      transport: transport.name,
      messageId,
      correlationId: job.correlationId,
    },
    'email sent',
  );
  return messageId;
}
