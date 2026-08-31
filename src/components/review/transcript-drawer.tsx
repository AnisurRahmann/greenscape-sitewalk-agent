'use client';

import { segmentTranscript } from '@/lib/review/evidence';

export interface TranscriptDrawerProps {
  open: boolean;
  transcript: string;
  evidences: string[];
  onClose: () => void;
}

/**
 * The trust feature, full-screen: the entire transcript with every line
 * item's verbatim evidence span highlighted, so a reviewer can read each
 * price in the exact context it came from.
 */
export function TranscriptDrawer({ open, transcript, evidences, onClose }: TranscriptDrawerProps) {
  if (!open) return null;
  const segments = segmentTranscript(transcript, evidences);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Site-walk transcript</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">
        {segments.map((segment, index) =>
          segment.highlighted ? (
            <mark
              key={index}
              className="rounded bg-amber-200 px-0.5 font-medium text-amber-950"
              title="Priced line item evidence"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
        {evidences.length === 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            No evidence spans on this proposal — nothing was matched to the transcript.
          </p>
        )}
      </div>
      <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">
        Highlighted spans are the verbatim evidence behind priced line items.
      </p>
    </div>
  );
}
