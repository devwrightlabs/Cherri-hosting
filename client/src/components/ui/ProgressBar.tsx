interface ProgressBarProps {
  /** 0–100. Ignored when `indeterminate` is true. */
  value?: number;
  /** When true the bar pulses to indicate unknown progress. */
  indeterminate?: boolean;
  className?: string;
}

/**
 * Thin, accessible progress bar.
 *
 * - Determinate: fills to `value` percent with a smooth transition.
 * - Indeterminate: pulses to indicate ongoing but unmeasurable work (e.g.
 *   IPFS pinning where we have no byte-count from the server).
 */
export default function ProgressBar({
  value = 0,
  indeterminate = false,
  className = '',
}: ProgressBarProps) {
  return (
    <div
      className={`h-1.5 w-full bg-surface-700 rounded-full overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {indeterminate ? (
        <div className="h-full w-full bg-cherry-500/70 animate-pulse rounded-full" />
      ) : (
        <div
          className="h-full bg-cherry-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      )}
    </div>
  );
}
