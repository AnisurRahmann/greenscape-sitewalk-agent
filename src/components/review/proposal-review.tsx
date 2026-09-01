'use client';

import { useMemo, useState, useTransition } from 'react';

import {
  approveProposal,
  commitLineEdit,
  generateProposalPdf,
  rejectProposal,
  verifyLineEvidence,
} from '@/app/(review)/proposals/[id]/actions';
import { Button } from '@/components/ui/button';
import { LineItemsTable } from '@/components/review/line-items-table';
import { RightRail } from '@/components/review/right-rail';
import { TranscriptDrawer } from '@/components/review/transcript-drawer';
import { toEngineInput, type ReviewLine } from '@/components/review/types';
import {
  evaluateRules,
  type GuardrailResult,
} from '@/lib/guardrails/rules';
import { priceProposal } from '@/lib/pricing/engine';

export interface ProposalReviewProps {
  proposalId: string;
  leadName: string;
  status: string;
  lines: ReviewLine[];
  validCatalogIds: string[];
  generationCostUsd: number;
  elapsedMs: number | null;
  transcript: string;
}

export function ProposalReview(props: ProposalReviewProps) {
  const [lines, setLines] = useState(props.lines);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [pdf, setPdf] = useState<{ pdfPath?: string; signedUrl?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const onGeneratePdf = () => {
    startTransition(() => {
      void generateProposalPdf(props.proposalId).then((outcome) => {
        if (outcome.ok) setPdf({ pdfPath: outcome.pdfPath, signedUrl: outcome.signedUrl });
        else console.error('pdf generation failed:', outcome.error);
      });
    });
  };

  const mainLines = lines.filter((line) => !line.isOptionalAddOn);
  const optionalLines = lines.filter((line) => line.isOptionalAddOn);

  // Live repricing through the REAL engine — identical math to the pipeline.
  // Stored unit prices are catalog list prices, so the tier applies exactly
  // once no matter how many times lines are re-priced.
  const live = useMemo(() => {
    const priced = priceProposal(mainLines.map(toEngineInput));
    // Engine lines keep input order; merge computed values onto the display rows.
    const computed = mainLines.map((line, index) => {
      const engineLine = priced.lineItems[index];
      return engineLine
        ? {
            quantity: engineLine.quantity,
            lineTotal: engineLine.lineTotal,
            discountBps: engineLine.discountBps,
          }
        : {
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            discountBps: line.discountBps,
          };
    });

    const guardrailLines = priced.lineItems.map((line) => ({
      sku: line.sku,
      catalogItemId: line.catalogItemId,
      description: line.description,
      category: line.category,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      matchConfidence: line.matchConfidence,
      committed: true,
    }));
    for (const optional of optionalLines) {
      guardrailLines.push({
        sku: optional.sku,
        catalogItemId: optional.catalogItemId,
        description: optional.description,
        category: optional.category,
        quantity: optional.quantity,
        lineTotal: optional.lineTotal,
        matchConfidence: optional.matchConfidence,
        committed: false,
      });
    }

    const results: GuardrailResult[] = evaluateRules({
      proposalId: props.proposalId,
      extraction: {
        schemaValid: true,
        retryCount: 0,
        items: mainLines.map((line) => ({
          rawPhrase: line.transcriptEvidence ?? line.description,
          committed: true,
          evidenceVerified: line.evidenceVerified,
        })),
      },
      proposal: {
        total: priced.total,
        marginPct: priced.marginPct,
        lineItems: guardrailLines,
      },
      validCatalogIds: new Set(props.validCatalogIds),
      agentRunCostUsd: props.generationCostUsd,
      elapsedMs: props.elapsedMs ?? 120_000,
    });

    const blocking = results.filter((r) => !r.passed && r.severity === 'block');
    const blockedLineIndexes = new Set<number>(
      blocking.flatMap((r) => (r.lineIndex === undefined ? [] : [r.lineIndex])),
    );

    return { priced, computed, results, blocking, blockedLineIndexes };
  }, [mainLines, optionalLines, props.proposalId, props.validCatalogIds, props.generationCostUsd, props.elapsedMs]);

  const setLine = (lineId: string, patch: Partial<ReviewLine>) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    // A human attesting an evidence span resolves the G2 block — audit it.
    if (patch.evidenceVerified === true) {
      startTransition(() => {
        void verifyLineEvidence(lineId, props.proposalId);
      });
    }
  };

  const onEditCommit = (lineId: string, field: 'quantity' | 'unit_price', before: number, after: number) => {
    startTransition(() => {
      void commitLineEdit({ lineId, proposalId: props.proposalId, field, before, after }).then(
        (outcome) => {
          if (!outcome.ok) console.error('line edit failed:', outcome.error);
        },
      );
    });
  };

  const onApprove = () => {
    startTransition(() => {
      // No totals sent: the server reprices from the database (CLAUDE.md rule 1).
      void approveProposal({ proposalId: props.proposalId })
        .then((outcome) => {
          if (outcome.ok) window.location.reload();
          else console.error('approve failed:', outcome.error);
        })
        .catch((err: unknown) => console.error('approve refused:', err));
    });
  };

  const onReject = () => {
    startTransition(() => {
      void rejectProposal(props.proposalId, reason).then((outcome) => {
        if (outcome.ok) window.location.reload();
        else console.error('reject failed:', outcome.error);
      });
    });
  };

  const evidenceList = mainLines
    .map((line) => line.transcriptEvidence)
    .filter((e): e is string => Boolean(e));

  const approveDisabled = live.blocking.length > 0;
  const approveTooltip =
    approveDisabled
      ? `Blocked by: ${live.blocking.map((rule) => rule.rule).join(', ')}`
      : 'Approve and send to the customer';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{props.leadName}</h1>
          <p className="text-xs text-muted-foreground">
            Proposal {props.proposalId.slice(0, 8)} · status {props.status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pdf?.signedUrl && (
            <a
              href={pdf.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-muted"
            >
              Download PDF ↓
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={onGeneratePdf}
          >
            {pdf ? 'Regenerate PDF' : 'Generate PDF'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setTranscriptOpen(true)}>
            View transcript
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Left: editable line items */}
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Line items</h2>
          <LineItemsTable
            lines={mainLines}
            onChange={setLine}
            onEditCommit={onEditCommit}
            blockedLineIndexes={live.blockedLineIndexes}
            computed={live.computed}
          />
        </section>

        {/* Right rail: totals, margin gauge, guardrails, add-ons, spend */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <RightRail
            totals={{
              subtotal: live.priced.subtotal,
              mobilizationFee: live.priced.mobilizationFee,
              contingency: live.priced.contingency,
              tax: live.priced.tax,
              total: live.priced.total,
              marginPct: live.priced.marginPct,
            }}
            guardrailResults={live.results}
            optionalLines={optionalLines}
            generationCostUsd={props.generationCostUsd}
            elapsedMs={props.elapsedMs}
          />
        </div>
      </div>

      {/* Bottom actions — sticky for one-thumb use in the truck. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-2">
          {rejecting && (
            <textarea
              rows={2}
              placeholder="Why is this proposal rejected?"
              className="w-full rounded-lg border p-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          {approveDisabled && (
            <p className="text-xs font-medium text-red-600" role="alert">
              Approval blocked: {live.blocking.map((rule) => rule.rule).join(', ')}
            </p>
          )}
          <div className="flex gap-2">
            {rejecting ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  disabled={isPending || !reason.trim()}
                  onClick={onReject}
                >
                  Confirm reject
                </Button>
                <Button type="button" variant="outline" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => setRejecting(true)}
                >
                  Reject…
                </Button>
                <span className="flex-1" title={approveTooltip}>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={approveDisabled || isPending}
                    onClick={onApprove}
                  >
                    Approve &amp; send
                  </Button>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <TranscriptDrawer
        open={transcriptOpen}
        transcript={props.transcript}
        evidences={evidenceList}
        onClose={() => setTranscriptOpen(false)}
      />
    </div>
  );
}
