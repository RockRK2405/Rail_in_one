import { env } from '@/env';
import { logger } from '@/lib/logger';

/**
 * Email transport abstraction.
 *
 * If RESEND_API_KEY is configured, transactional email is sent via Resend.
 * Otherwise a "log transport" records the message (real, observable delivery in
 * development/CI) and returns a synthetic message id. Either way the caller gets
 * a delivery result it can persist to the EmailLog outbox. No secrets or PII
 * beyond the recipient/subject are logged.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  providerMessageId: string;
  provider: 'resend' | 'log';
}

export async function sendEmail(message: OutgoingEmail): Promise<SendResult> {
  const apiKey = env().RESEND_API_KEY;
  const from = env().EMAIL_FROM ?? 'Ticketing <tickets@example.com>';

  if (!apiKey) {
    // Dev/CI transport: record that the email would be sent. This is a real,
    // observable action (not a fabricated "sent" against a real provider).
    logger.info({ to: message.to, subject: message.subject }, 'email (log transport)');
    return { providerMessageId: `log_${crypto.randomUUID()}`, provider: 'log' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, html: message.html }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string };
  return { providerMessageId: body.id ?? `resend_${Date.now()}`, provider: 'resend' };
}
