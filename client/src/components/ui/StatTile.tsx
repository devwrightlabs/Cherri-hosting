import React from 'react';

interface StatTileProps {
  label: string;
  /** Pre-formatted value. Pass `undefined` while loading to show a skeleton. */
  value?: React.ReactNode;
  /** Optional secondary line under the value. */
  sub?: React.ReactNode;
  /** Render the value in JetBrains Mono (for π amounts, counts, sizes). */
  mono?: boolean;
  isLoading?: boolean;
  className?: string;
}

/**
 * Compact metric tile for dashboard stat rows. Never renders NaN/undefined —
 * shows a skeleton while loading and an em dash when a value is missing.
 */
export default function StatTile({
  label,
  value,
  sub,
  mono = false,
  isLoading = false,
  className = '',
}: StatTileProps) {
  return (
    <div
      className={`rounded-xl bg-surface-900 border border-hairline p-3.5 ${className}`}
    >
      <p className="text-ink-mut text-[11px] uppercase tracking-wider">{label}</p>
      {isLoading ? (
        <div className="skeleton h-6 w-16 mt-2" />
      ) : (
        <p
          className={`text-ink font-semibold mt-1 leading-tight ${
            mono ? 'font-mono text-lg' : 'text-2xl font-display'
          }`}
        >
          {value ?? '—'}
        </p>
      )}
      {sub && !isLoading && <div className="mt-1 text-xs text-ink-mut">{sub}</div>}
    </div>
  );
}
