export interface TwilioSmsInput {
  to: string;
  body: string;
}

/** Sends via Twilio's REST API with Basic auth. Throws on failure. */
export async function sendTwilioSms(input: TwilioSmsInput): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)');
  }

  const body = new URLSearchParams({
    To: input.to,
    From: fromNumber,
    Body: input.body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`twilio failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { sid?: string };
  return json.sid ?? 'twilio-accepted';
}
