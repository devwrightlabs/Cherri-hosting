import React from 'react';
import { Link } from 'react-router-dom';
import LogoMark from './ui/LogoMark';
import EnvToggle from './EnvToggle';
import NotificationBell from './NotificationBell';
import { usePiEnv } from '../lib/piEnv';
import { useAuth } from '../providers/AuthProvider';

interface TopBarProps {
  right?: React.ReactNode;
  title?: string;
}

/**
 * Sticky top bar: brand mark + TESTNET badge left, notification bell + TEST|LIVE toggle right.
 * z-50 + relative ensures it stays above the env-switch confirm sheet (z-40).
 */
export default function TopBar({ right, title }: TopBarProps) {
  const env = usePiEnv();
  const { isAuthenticated } = useAuth();
  return (
    <header className="safe-top shrink-0 relative z-50 bg-surface-950/90 backdrop-blur-md border-b border-hairline">
      <div className="h-14 px-4 flex items-center gap-2 max-w-screen-sm mx-auto w-full">
        <Link to="/dashboard" className="flex items-center gap-2 min-w-0">
          <LogoMark size={26} />
          <span className="font-display font-bold text-ink text-[15px] tracking-tight truncate">
            {title ?? 'Cherri'}
          </span>
        </Link>
        {env === 'testnet' && (
          <span className="shrink-0 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-gold">
            testnet
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {right}
          {isAuthenticated && <NotificationBell />}
          <EnvToggle />
        </div>
      </div>
    </header>
  );
}
