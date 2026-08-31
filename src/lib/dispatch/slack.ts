export interface SlackNotifyInput {
  text: string;
}

/** Posts to the internal incoming webhook. Team visibility, not the customer. */
export async function sendSlackNotify(input: SlackNotifyInput): Promise<string> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('SLACK_WEBHOOK_URL not configured');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.text }),
  });
  if (!response.ok) {
    throw new Error(`slack webhook failed (${response.status})`);
  }
  return 'slack-accepted';
}
