'use client';

import { useState } from 'react';

import { MATCH_CHIP_STYLES, type ReviewLine } from '@/components/review/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface LineItemsTableProps {
  lines: ReviewLine[];
  onChange: (lineId: string, patch: Partial<Pick<ReviewLine, 'quantity' | 'unitPrice' | 'evidenceVerified'>>) => void;
  onEditCommit: (lineId: string, field: 'quantity' | 'unit_price', before: number, after: number) => void;
  /** Soft-delete: persisted with a required reason via the server action. */
  onExclude?: (lineId: string, reason: string) => void;
  blockedLineIndexes: Set<number>;
  /** Engine-computed values (coerced qty, line total, applied volume tier). */
  computed: Array<{ quantity: number; lineTotal: number; discountBps: number }>;
}

export function LineItemsTable({
  lines,
  onChange,
  onEditCommit,
  onExclude,
  blockedLineIndexes,
  computed,
}: LineItemsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [excludePromptId, setExcludePromptId] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState('');

  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => {
        const isBlocked = blockedLineIndexes.has(index);
        const isAmber = line.needsReview && !isBlocked;
        const computedLine = computed[index];
        const rowTone = isBlocked
          ? 'border-red-300 bg-red-50'
          : isAmber
            ? 'border-amber-300 bg-amber-50'
            : 'border';

        return (
          <div key={line.id} className={`rounded-xl border ${rowTone}`}>
            {/* Summary row — tap anywhere to reveal the evidence. */}
            <button
              type="button"
              className="w-full px-3 py-2.5 text-left"
              onClick={() => setExpandedId(expandedId === line.id ? null : line.id)}
              aria-expanded={expandedId === line.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${
                      line.excluded ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    {line.description}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                        MATCH_CHIP_STYLES[line.matchMethod] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {line.matchMethod}
                    </span>
                    {line.sku ? (
                      <span className="text-[10px] text-muted-foreground">{line.sku}</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                        unmatched
                      </span>
                    )}
                    {(computedLine?.discountBps ?? 0) > 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        −{(computedLine!.discountBps / 100).toFixed(0)}% volume tier
                      </span>
                    )}
                    {isBlocked && (
                      <span className="text-[10px] font-semibold uppercase text-red-600">blocked</span>
                    )}
                    {isAmber && (
                      <span className="text-[10px] font-semibold uppercase text-amber-600">
                        needs review
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  ${(computedLine?.lineTotal ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">confidence</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.round((line.matchConfidence ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {Math.round((line.matchConfidence ?? 0) * 100)}%
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {expandedId === line.id ? 'hide evidence ▲' : 'evidence ▼'}
                </span>
              </div>
            </button>

            {/* Editable fields — inputs stop propagation so tapping them does
                not toggle the evidence panel. Excluded lines keep their data
                but render muted and locked. */}
            {line.excluded ? (
              <div className="border-t px-3 py-2" onClick={(event) => event.stopPropagation()}>
                <p className="text-[10px] font-medium text-amber-700">
                  Excluded from pricing{line.excludedReason ? ` — ${line.excludedReason}` : ''}
                </p>
              </div>
            ) : (
            <div
              className="grid grid-cols-3 gap-2 border-t px-3 py-2"
              onClick={(event) => event.stopPropagation()}
            >
              <label className="flex flex-col text-[10px] text-muted-foreground">
                Qty
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="h-8"
                  value={line.quantity}
                  disabled={line.isOptionalAddOn}
                  onChange={(e) =>
                    onChange(line.id, { quantity: Number(e.target.value) || 0 })
                  }
                  onBlur={(e) => {
                    const after = Number(e.target.value) || 0;
                    if (after !== line.quantity) onEditCommit(line.id, 'quantity', line.quantity, after);
                  }}
                />
              </label>
              <label className="flex flex-col text-[10px] text-muted-foreground">
                List price $
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  className="h-8"
                  value={line.unitPrice}
                  onChange={(e) =>
                    onChange(line.id, { unitPrice: Number(e.target.value) || 0 })
                  }
                  onBlur={(e) => {
                    const after = Number(e.target.value) || 0;
                    if (after !== line.unitPrice) onEditCommit(line.id, 'unit_price', line.unitPrice, after);
                  }}
                />
              </label>
              <label className="flex flex-col text-[10px] text-muted-foreground">
                Unit
                <Input className="h-8" value={line.unit} readOnly tabIndex={-1} />
              </label>
              {onExclude &&
                (excludePromptId === line.id ? (
                  <div className="col-span-3 flex items-center gap-2">
                    <Input
                      className="h-8"
                      value={excludeReason}
                      placeholder="Reason for removing (required)"
                      autoFocus
                      onChange={(e) => setExcludeReason(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!excludeReason.trim()}
                      onClick={() => {
                        onExclude(line.id, excludeReason.trim());
                        setExcludePromptId(null);
                        setExcludeReason('');
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setExcludePromptId(null);
                        setExcludeReason('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="col-span-3 h-7 justify-self-start text-[10px] text-red-600 hover:text-red-700"
                    onClick={() => setExcludePromptId(line.id)}
                  >
                    Remove line…
                  </Button>
                ))}
            </div>
            )}

            {/* Trust feature: the verbatim evidence for this line. */}
            {expandedId === line.id && (
              <div className="border-t bg-white/60 px-3 py-2.5">
                {line.transcriptEvidence ? (
                  <blockquote className="border-l-2 border-blue-400 pl-2 text-xs italic">
                    “{line.transcriptEvidence}”
                  </blockquote>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No transcript evidence — this line was not tied to anything the contractor said.
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className={`text-[10px] ${line.evidenceVerified ? 'text-emerald-700' : 'text-red-600'}`}>
                    {line.evidenceVerified ? '✓ evidence verified against transcript' : '✗ evidence not found in transcript'}
                  </span>
                  {!line.evidenceVerified && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onChange(line.id, { evidenceVerified: true })}
                    >
                      I verified this in the transcript
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
