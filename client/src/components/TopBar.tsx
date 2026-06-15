import React from 'react';
import { Link } from 'react-router-dom';
import LogoMark from './ui/LogoMark';
import EnvToggle from './EnvToggle';
import { usePiEnv } from '../lib/piEnv';

interface TopBarProps {
  /** Right-aligned slot for page-specific actions, left of the env toggle. */
  right?: React.ReactNode;
  /** Optional screen title shown under nothing — kept minimal/mobile. */
  title?: string;
}

/**
 * Sticky top bar: brand mark + a monospace TESTNET badge on the left, the
 * TEST|LIVE env toggle (plus any page action slot) on the right.
 * Safe-area aware so nothing hides under the notch.
 */
export default function TopBar({ right, title }: TopBarProps) {
  const env = usePiEnv();
  return (
    <header className="safe-top shrink-0 bg-surface-950/90 backdrop-blur-md border-b border-hairline">
      <div className="h-14 px-4 flex items-center gap-2 max-w-screen-sm mx-auto w-full">
        <Link to="/dashboard" className="flex items-center gap-2 min-w-0">
          <LogoMark size={26} />
          <span className="font-display font-bold text-ink text-[15px] tracking-tight truncate">
            {title ?? 'Sherry'}
          </span>
        </Link>
        {env === 'testnet' && (
          <span className="shrink-0 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-gold">
            testnet
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {right}
          <EnvToggle />
        </div>
      </div>
    </header>
  );
}
