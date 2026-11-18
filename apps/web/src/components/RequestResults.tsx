import { CONCURRENCY } from '@idempotent-ledger/terms';

import type { RunEntry } from '@/lib/types';

type RequestResultsProps = {
  entries: RunEntry[];
};

const OUTCOME_CLASSNAME: Record<string, string> = {
  processed: 'text-primary',
  duplicate: 'text-info',
};

const FAILED_OUTCOME_CLASSNAME = 'text-destructive-foreground';

function getOutcomeClassName(outcome: string) {
  return OUTCOME_CLASSNAME[outcome] ?? FAILED_OUTCOME_CLASSNAME;
}

export function RequestResults({ entries }: RequestResultsProps) {
  if (!entries.length) {
    return (
      <div className="min-h-32 rounded-[1.5rem] border border-dashed border-border/70 bg-background/40 p-4 font-mono text-xs text-muted-foreground">
        <p className="text-center text-sm">{CONCURRENCY.RUN_SCENARIO_HINT}</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-32 rounded-[1.5rem] border border-dashed border-border/70 bg-background/40 p-4 font-mono text-xs text-muted-foreground"
      aria-live="polite"
    >
      <ul className="space-y-2">
        {entries.map(entry => (
          <li
            key={entry.label}
            className="rounded-2xl border border-border/60 bg-surface/70 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="shrink-0 text-foreground">{entry.label}</span>
              <span className="min-w-0 break-all">{entry.id}</span>
              <span
                className={[
                  'shrink-0 font-semibold',
                  getOutcomeClassName(entry.outcome),
                ].join(' ')}
              >
                {entry.outcome.toUpperCase()}
              </span>
              <span className="ml-auto shrink-0 tabular-nums">{entry.ms}ms</span>
            </div>
            {entry.detail ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {entry.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
