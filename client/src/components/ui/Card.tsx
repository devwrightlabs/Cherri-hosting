import React from 'react';

type Padding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  /** Internal padding. Default `md` (20px). Use `none` for full-bleed content. */
  padding?: Padding;
  /** Inline styles — used for per-card animation delays in staggered entrances. */
  style?: React.CSSProperties;
}

const paddingClasses: Record<Padding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

/**
 * Standard surface card: solid background clearly separated from the page,
 * 16px radius, a soft shadow and a subtle 1px hairline border. Tapping a card
 * (when `onClick` is set) lifts its border to the accent.
 */
export default function Card({
  children,
  className = '',
  onClick,
  padding = 'md',
  style,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={`rounded-2xl bg-surface-900 border border-hairline shadow-card ${paddingClasses[padding]} ${
        onClick ? 'cursor-pointer hover:border-cherry-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200' : 'transition-colors duration-200'
      } ${className}`}
    >
      {children}
    </div>
  );
}
