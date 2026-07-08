import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label rendered above the field. */
  label?: string;
  /** Muted helper text rendered below the field. */
  helperText?: string;
  /** Error text rendered below the field (overrides helperText styling). */
  errorText?: string;
}

/**
 * Standard text input: a clear label above, a tall comfortable field with a
 * visible focus ring, and a slot below for helper or error text. Forwards a ref
 * so it can be focused/measured by parents.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, errorText, className = '', id, ...props },
  ref,
) {
  const inputId = id ?? props.name ?? label?.toLowerCase().replace(/\s+/g, '-');
  const invalid = Boolean(errorText);

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-medium text-ink-mut mb-2 tracking-wide"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid}
        className={`w-full min-h-[48px] bg-surface-800 border rounded-xl px-4 text-ink text-sm placeholder:text-ink-mut/60 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950 hover:bg-surface-700/50 ${
          invalid
            ? 'border-red-500/50 focus:ring-red-500'
            : 'border-surface-600 focus:border-cherry-500/50 focus:ring-cherry-500'
        } ${className}`}
        {...props}
      />
      {errorText ? (
        <p className="text-xs text-red-400 mt-2 animate-fade-in">{errorText}</p>
      ) : helperText ? (
        <p className="text-xs text-ink-mut mt-2">{helperText}</p>
      ) : null}
    </div>
  );
});

export default Input;
