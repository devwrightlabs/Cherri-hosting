import React from 'react';

interface StatTileProps {
  label: string;
  /** Pre-formatted value. Pass `undefined` while loading to show a skeleton. */
  value?: React.ReactNode;
  /** Optional secondary line under the label. */
  sub?: React.ReactNode;
  /** Render the value in JetBrains Mono (for π amounts, counts, sizes). */
  mono?: boolean;
  /** Optional small icon shown top-right of the tile. */
  icon?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
}

/**
 * Metric tile: a big confident number first, a small muted label beneath, and
 * generous padding. Never renders NaN/undefined — shows a skeleton while
 * loading and an em dash when a value is missing.
 */
export default function StatTile({
  label,
  value,
  sub,
  mono = false,
  icon,
  isLoading = false,
  className = '',
}: StatTileProps) {
  return (
    <div
      className={`rounded-2xl bg-surface-900 border border-hairline shadow-card p-5 ${className}`}
    >
      {icon && <div className="flex justify-between mb-3 text-ink-mut">{icon}</div>}
      {isLoading ? (
        <div className="skeleton h-8 w-20" />
      ) : (
        <p
          className={`text-ink font-bold leading-none ${
            mono ? 'font-mono text-2xl' : 'text-[2rem] font-display'
          }`}
        >
          {value ?? '—'}
        </p>
      )}
      <p className="text-ink-mut text-xs mt-2.5">{label}</p>
      {sub && !isLoading && <div className="mt-1.5 text-xs text-ink-mut">{sub}</div>}
    </div>
  );
}
