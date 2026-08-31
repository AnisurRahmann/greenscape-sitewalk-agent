/**
 * Evidence traceability: locates each line item's verbatim evidence span
 * inside the raw transcript so the review UI can highlight exactly why the
 * agent priced something. Matching is normalised (case-insensitive,
 * whitespace-flexible) to mirror the guardrail containment check, but the
 * returned offsets point into the ORIGINAL transcript string.
 */

export interface EvidenceSpan {
  evidence: string;
  start: number;
  end: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findEvidenceSpans(transcript: string, evidences: string[]): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  const taken = Array.from({ length: transcript.length }, () => false);

  for (const evidence of evidences) {
    const trimmed = evidence.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(escapeRegex(trimmed).replace(/\s+/g, '\\s+'), 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(transcript)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // First-come placement: overlapping evidence spans keep their earliest
      // owner, and already-highlighted transcript regions are not re-claimed.
      const overlaps = taken.slice(start, end).some(Boolean);
      if (overlaps) continue;
      for (let i = start; i < end; i += 1) taken[i] = true;
      spans.push({ evidence: trimmed, start, end });
      break;
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

/** Splits the transcript into plain and highlighted segments for rendering. */
export function segmentTranscript(
  transcript: string,
  evidences: string[],
): Array<{ text: string; highlighted: boolean }> {
  const spans = findEvidenceSpans(transcript, evidences);
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({ text: transcript.slice(cursor, span.start), highlighted: false });
    }
    segments.push({ text: transcript.slice(span.start, span.end), highlighted: true });
    cursor = span.end;
  }
  if (cursor < transcript.length) {
    segments.push({ text: transcript.slice(cursor), highlighted: false });
  }
  return segments;
}
