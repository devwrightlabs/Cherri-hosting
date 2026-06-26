import React from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'premium' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  /** Show a leading status dot in the variant colour. */
  dot?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-surface-800 text-ink-mut border border-surface-600',
  success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  error: 'bg-red-500/15 text-red-400 border border-red-500/30',
  premium: 'bg-cherry-500/15 text-cherry-300 border border-cherry-500/30',
  info: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
};

const dotClasses: Record<BadgeVariant, string> = {
  default: 'bg-ink-mut',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
  premium: 'bg-cherry-300',
  info: 'bg-blue-400',
};

export default function Badge({
  variant = 'default',
  children,
  className = '',
  dot = false,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium leading-none ${variantClasses[variant]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[variant]}`} />}
      {children}
    </span>
  );
}
