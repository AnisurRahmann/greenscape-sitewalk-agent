import { z } from 'zod';

export const leadDetailsSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(120),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
  email: z
    .email()
    .max(160)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  address: z.string().trim().max(240).optional(),
});

export const submitSitewalkSchema = z.discriminatedUnion('inputMode', [
  z.object({
    inputMode: z.literal('audio'),
    lead: leadDetailsSchema,
    audioPath: z.string().min(1).max(400),
  }),
  z.object({
    inputMode: z.literal('text'),
    lead: leadDetailsSchema,
    transcript: z.string().trim().min(1, 'Paste the site-walk notes').max(50_000),
  }),
]);

export type LeadDetails = z.infer<typeof leadDetailsSchema>;
export type SubmitSitewalkInput = z.infer<typeof submitSitewalkSchema>;

export interface SubmitSitewalkResult {
  ok: boolean;
  error?: string;
  siteWalkId?: string;
  leadId?: string;
}

/** Storage path inside the sitewalks bucket must be `<uuid>.<ext>`. */
export function isSafeAudioPath(path: string): boolean {
  return /^[a-f0-9-]{36}\.(webm|mp4|m4a|wav|mp3|ogg)$/i.test(path);
}
