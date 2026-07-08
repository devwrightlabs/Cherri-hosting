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
      className={`rounded-2xl bg-surface-900 border border-hairline shadow-card px-6 py-12 text-center flex flex-col items-center animate-fade-in ${className}`}
    >
      {icon && (
        <div className="mb-6 flex items-center justify-center w-16 h-16 rounded-[20px] bg-surface-800 border border-hairline text-gold shadow-sm">
          {icon}
        </div>
      )}
      <h3 className="font-display font-bold text-ink text-xl tracking-tight">{title}</h3>
      <p className="text-ink-mut text-sm mt-2 max-w-[260px] leading-relaxed">{description}</p>
      {action && <div className="mt-7 w-full max-w-[200px] mx-auto">{action}</div>}
    </div>
  );
}
