import OpenAI from 'openai';

import { recordAgentRun, type AgentRunContext } from '@/lib/agent-runs';
import { getSupabaseAdmin } from '@/lib/db/client';

export const SITEWALK_BUCKET = 'sitewalks';
export const WHISPER_MODEL = 'whisper-1';
// $0.006 per minute of audio (whisper-1 list price).
const WHISPER_COST_PER_MINUTE_USD = 0.006;
// Wall-clock dead-man switch: a hung transcription must never block the
// ingest pipeline indefinitely (CLAUDE.md rule 6 spirit, applied per call).
const TRANSCRIBE_TIMEOUT_MS = 120_000;

export interface TranscriptionResult {
  text: string;
  durationSeconds: number;
  provider: string;
}

/**
 * Downloads the recording from Storage, transcribes it with whisper-1, and
 * audits the call to agent_runs. Cost is computed from audio duration at
 * $0.006/min — never estimated by an LLM (CLAUDE.md rule 1).
 */
export async function transcribeAudio(
  path: string,
  ctx?: AgentRunContext,
): Promise<TranscriptionResult> {
  const startedAt = Date.now();
  try {
    const { data: blob, error } = await getSupabaseAdmin()
      .storage.from(SITEWALK_BUCKET)
      .download(path);
    if (error) throw new Error(`storage download failed: ${error.message}`);
    if (!blob) throw new Error('storage download returned no object');

    const fileName = path.split('/').pop() ?? 'audio.webm';
    const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
    });
    // verbose_json is what carries the audio duration we price from.
    const transcription = await openai.audio.transcriptions.create(
      {
        model: WHISPER_MODEL,
        file,
        response_format: 'verbose_json',
      },
      { timeout: TRANSCRIBE_TIMEOUT_MS },
    );

    const durationSeconds = Math.round(transcription.duration ?? 0);
    const latencyMs = Date.now() - startedAt;
    await recordAgentRun(ctx ?? { step: 'transcribe' }, {
      model: WHISPER_MODEL,
      tokensIn: null,
      tokensOut: null,
      costUsd: (durationSeconds / 60) * WHISPER_COST_PER_MINUTE_USD,
      latencyMs,
      status: 'ok',
    });

    return { text: transcription.text, durationSeconds, provider: 'openai/whisper-1' };
  } catch (err) {
    await recordAgentRun(ctx ?? { step: 'transcribe' }, {
      model: WHISPER_MODEL,
      tokensIn: null,
      tokensOut: null,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Transcribes a site walk's audio and persists the transcript. Runs after the
 * ingest response via after() so the form never waits on whisper; on failure
 * the transcript stays null (already audited) and the extraction step will
 * route the walk to human review.
 */
export async function transcribeSiteWalk(siteWalkId: string, audioPath: string): Promise<void> {
  const result = await transcribeAudio(audioPath, { step: 'transcribe', siteWalkId });
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('site_walks')
    .update({
      transcript: result.text,
      duration_seconds: result.durationSeconds,
      transcript_provider: result.provider,
    })
    .eq('id', siteWalkId);
  if (error) throw new Error(`failed to store transcript: ${error.message}`);
}
