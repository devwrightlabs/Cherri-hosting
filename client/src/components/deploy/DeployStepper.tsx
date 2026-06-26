interface DeployStepperProps {
  steps: string[];
  /** Zero-based index of the in-progress step. */
  current: number;
  /** When true, the current step is treated as finished (whole flow done). */
  complete?: boolean;
}

/**
 * Vertical progress rail for the deploy pipeline. Each step sits on its own row
 * with a connector line; finished steps fill teal with a check, the active step
 * is ringed in teal, and upcoming steps stay muted.
 */
export default function DeployStepper({ steps, current, complete = false }: DeployStepperProps) {
  return (
    <ol className="px-1">
      {steps.map((label, i) => {
        const done = complete ? i <= current : i < current;
        const active = !complete && i === current;
        const isLast = i === steps.length - 1;

        return (
          <li key={label} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0 transition-colors ${
                  done
                    ? 'bg-cherry-gradient text-surface-950'
                    : active
                      ? 'border-2 border-cherry-500 bg-cherry-500/10 text-cherry-300'
                      : 'border border-surface-600 bg-surface-900 text-ink-mut'
                }`}
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {!isLast && (
                <span
                  className={`w-px flex-1 my-1 min-h-[18px] ${done ? 'bg-cherry-500' : 'bg-surface-700'}`}
                />
              )}
            </div>
            <div className={isLast ? 'pt-1' : 'pt-1 pb-5'}>
              <span
                className={`text-sm ${
                  active ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-ink-mut'
                }`}
              >
                {label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
