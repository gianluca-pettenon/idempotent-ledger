import { CONCURRENCY } from '@banking-ledger/terms';

import type { RunEntry } from '@/app/types';

type RequestResultsProps = {
  entries: RunEntry[];
};

const OUTCOME_CLASSNAME: Record<string, string> = {
  processed: 'border-primary/30 bg-primary/10 text-primary',
  duplicate: 'border-info/30 bg-info/10 text-info',
};

const FAILED_OUTCOME_CLASSNAME = 'border-destructive/30 bg-destructive/10 text-destructive-foreground';

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
        {entries.map((entry) => (
          <li
            key={entry.label}
            className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-surface/70 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2 text-foreground">
              <span>{entry.label}</span>
              <span className="text-muted-foreground">·</span>
              <span
                className={[
                  'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]',
                  getOutcomeClassName(entry.outcome),
                ].join(' ')}
              >
                {entry.outcome}
              </span>
            </div>
            <span>{entry.ms}ms</span>
            {entry.detail ? (
              <span className="w-full text-[11px] text-muted-foreground">{entry.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
