import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-cherry-gradient text-surface-950 font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shadow-gold-sm transition-all',
  secondary:
    'bg-surface-800 text-ink border border-surface-600 hover:bg-surface-700 hover:border-cherry-500/50 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all',
  ghost:
    'text-ink-mut hover:text-ink hover:bg-surface-800 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all',
  danger:
    'bg-red-600 text-white hover:bg-red-500 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all',
};

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-[44px] px-4 text-sm',
  md: 'min-h-[48px] px-5 text-sm',
  lg: 'min-h-[54px] px-6 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-cherry-500 focus:ring-offset-2 focus:ring-offset-surface-950 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  );
}
