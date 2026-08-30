/**
 * Environment Toggle Component
 * 
 * Allows switching between Live and Test Pi Network environments.
 * Affects which blockchain network is used and payment processing.
 */

import { motion } from 'framer-motion';
import Card from './ui/Card';

interface EnvironmentToggleProps {
  environment: 'Live' | 'Test';
  onChange: (env: 'Live' | 'Test') => void;
  disabled?: boolean;
}

export default function EnvironmentToggle({
  environment,
  onChange,
  disabled = false,
}: EnvironmentToggleProps) {
  const isLive = environment === 'Live';

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink-mut uppercase tracking-wide">Network</p>
          <p className="text-sm text-ink mt-0.5">{environment} Pi Network</p>
        </div>

        {/* Toggle Switch */}
        <button
          onClick={() => onChange(isLive ? 'Test' : 'Live')}
          disabled={disabled}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
            isLive
              ? 'bg-live/30 hover:bg-live/40'
              : 'bg-surface-700 hover:bg-surface-600'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`inline-block h-7 w-7 rounded-full transition-colors ${
              isLive ? 'bg-live shadow-lg shadow-live/50' : 'bg-surface-800'
            }`}
            style={{
              marginLeft: isLive ? '6px' : '2px',
            }}
          />
        </button>
      </div>

      {/* Environment info */}
      <div className="mt-3 pt-3 border-t border-hairline space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-mut uppercase tracking-[0.08em]">
          {isLive ? 'Production' : 'Sandbox'}
        </p>
        <p className="text-xs text-ink-mut leading-relaxed">
          {isLive
            ? 'Real Pi payments on mainnet. Payments are final.'
            : 'Test network. No real value. Perfect for development.'}
        </p>
      </div>
    </Card>
  );
}
