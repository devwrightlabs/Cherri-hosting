import React from 'react';

interface PageHeaderProps {
  /** Large display title for the screen. */
  title: string;
  /** Optional one-line muted subtitle below the title. */
  subtitle?: string;
  /** Optional right-aligned action (e.g. a secondary button or link). */
  action?: React.ReactNode;
  /** Optional element rendered above the title (e.g. an eyebrow/greeting). */
  eyebrow?: React.ReactNode;
  className?: string;
}

/**
 * The single page-header pattern used across every screen: a large display
 * title, an optional muted subtitle, and an optional right-aligned action.
 * Gives every screen the same confident hierarchy and spacing rhythm.
 */
export default function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
  className = '',
}: PageHeaderProps) {
  return (
    <header className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-xs font-medium text-ink-mut mb-1.5">{eyebrow}</div>
        )}
        <h1 className="text-[1.75rem] leading-[1.1] font-bold text-ink font-display tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-ink-mut text-sm mt-2 leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 pt-0.5">{action}</div>}
    </header>
  );
}
