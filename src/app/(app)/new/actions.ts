'use server';

import { after } from 'next/server';

import { runSitewalkPipeline } from '@/lib/agent/orchestrator';
import { getSupabaseAdmin } from '@/lib/db/client';
import {
  isSafeAudioPath,
  submitSitewalkSchema,
  type SubmitSitewalkInput,
  type SubmitSitewalkResult,
} from '@/lib/ingest/schema';

export interface SignedSitewalkUpload {
  ok: boolean;
  error?: string;
  signedUrl?: string;
  path?: string;
}

const AUDIO_EXTENSIONS = new Set(['webm', 'mp4', 'm4a', 'wav', 'mp3', 'ogg']);

/**
 * Mints a signed upload URL so the browser PUTs the recording straight to
 * Storage — audio bytes never pass through the Next.js server.
 */
export async function createSignedSitewalkUpload(
  fileExtension: string,
): Promise<SignedSitewalkUpload> {
  const ext = fileExtension.toLowerCase().replace(/^\./, '');
  if (!AUDIO_EXTENSIONS.has(ext)) {
    return { ok: false, error: `unsupported audio extension: ${ext}` };
  }

  const path = `${crypto.randomUUID()}.${ext}`;
  const { data, error } = await getSupabaseAdmin()
    .storage.from('sitewalks')
    .createSignedUploadUrl(path);

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'failed to create upload URL' };
  }

  return { ok: true, signedUrl: data.signedUrl, path: data.path };
}

export async function submitSitewalk(
  input: SubmitSitewalkInput,
): Promise<SubmitSitewalkResult> {
  const parsed = submitSitewalkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  }
  const payload = parsed.data;

  if (payload.inputMode === 'audio' && !isSafeAudioPath(payload.audioPath)) {
    return { ok: false, error: 'invalid audio path' };
  }

  const supabase = getSupabaseAdmin();

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      full_name: payload.lead.fullName,
      phone: payload.lead.phone ?? null,
      email: payload.lead.email ?? null,
      address: payload.lead.address ?? null,
      source: 'sitewalk',
    })
    .select('id')
    .single();
  if (leadError || !lead) {
    return { ok: false, error: leadError?.message ?? 'failed to create lead' };
  }

  const { data: siteWalk, error: walkError } = await supabase
    .from('site_walks')
    .insert(
      payload.inputMode === 'audio'
        ? {
            lead_id: lead.id,
            input_mode: 'audio',
            audio_path: payload.audioPath,
            // Transcript arrives via the post-response whisper call below.
          }
        : {
            lead_id: lead.id,
            input_mode: 'text',
            // Text mode skips transcription entirely: cheaper, and the
            // reliable demo fallback.
            transcript: payload.transcript,
            transcript_provider: 'manual',
          },
    )
    .select('id')
    .single();
  if (walkError || !siteWalk) {
    return { ok: false, error: walkError?.message ?? 'failed to create site walk' };
  }

  // The full pipeline (transcribe -> ... -> persist) runs after the response
  // is sent; the browser polls /api/pipeline-status/[siteWalkId] for live
  // progress. Text mode skips transcription inside the pipeline.
  after(() =>
    runSitewalkPipeline(siteWalk.id).then((result) => {
      if (result.status !== 'completed') {
        console.warn(`pipeline ${siteWalk.id} ended as ${result.status}:`, result.message);
      }
    }),
  );

  return { ok: true, leadId: lead.id, siteWalkId: siteWalk.id };
}
