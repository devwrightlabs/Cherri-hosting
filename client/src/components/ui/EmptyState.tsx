import React from 'react';

interface EmptyStateProps {
  /** A simple geometric/stroke icon node — no raw emoji in chrome. */
  icon?: React.ReactNode;
  title: string;
  /** One sentence of context. */
  description: string;
  /** Primary call to action — empty states always give direction. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Empty state: context + one action. Never "Nothing here yet" (copy rule).
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-2xl bg-surface-900 border border-hairline px-6 py-10 text-center flex flex-col items-center ${className}`}
    >
      {icon && (
        <div className="mb-4 flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-800 border border-hairline text-gold">
          {icon}
        </div>
      )}
      <h3 className="font-display font-semibold text-ink text-base">{title}</h3>
      <p className="text-ink-mut text-sm mt-1.5 max-w-xs">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
