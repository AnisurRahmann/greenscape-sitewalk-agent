const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Base64-encoded PDF attachment. */
  attachmentBase64?: string;
  attachmentFilename?: string;
}

/** Sends via Resend. Throws on failure; retry/backoff is the caller's job. */
export async function sendResendEmail(input: ResendEmailInput): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');
  const from = process.env.EMAIL_FROM ?? 'Greenscape Pro <proposals@greenscapepro.com>';

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.attachmentBase64
        ? {
            attachments: [
              { filename: input.attachmentFilename ?? 'proposal.pdf', content: input.attachmentBase64 },
            ],
          }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`resend failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { id?: string };
  return json.id ?? 'resend-accepted';
}
