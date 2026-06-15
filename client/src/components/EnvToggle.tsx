import { useState } from 'react';
import { usePiEnvSwitch } from '../hooks/usePiEnvSwitch';
import { ALLOW_ENV_TOGGLE, type PiEnv } from '../lib/piEnv';
import Button from './ui/Button';

/**
 * Segmented TEST|LIVE control for the top bar. TEST active = gold, LIVE active
 * = live-green (matching the testnet badge / live-deploy colour language).
 * Switching to LIVE first raises a confirm sheet; the actual switch is gated
 * honestly inside usePiEnvSwitch.
 */
export default function EnvToggle() {
  const { env, switching, switchEnv } = usePiEnvSwitch();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!ALLOW_ENV_TOGGLE) return null;

  const select = (next: PiEnv) => {
    if (switching || next === env) return;
    if (next === 'mainnet') {
      setConfirmOpen(true);
      return;
    }
    void switchEnv('testnet');
  };

  const confirmMainnet = () => {
    setConfirmOpen(false);
    void switchEnv('mainnet');
  };

  return (
    <>
      <div
        role="group"
        aria-label="Pi environment"
        className="flex shrink-0 items-center rounded-full border border-hairline bg-surface-900 p-0.5 text-[11px] font-semibold"
      >
        <button
          type="button"
          onClick={() => select('testnet')}
          disabled={switching}
          aria-pressed={env === 'testnet'}
          className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-60 ${
            env === 'testnet' ? 'bg-gold text-surface-950' : 'text-ink-mut'
          }`}
        >
          TEST
        </button>
        <button
          type="button"
          onClick={() => select('mainnet')}
          disabled={switching}
          aria-pressed={env === 'mainnet'}
          className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-60 ${
            env === 'mainnet' ? 'bg-live text-surface-950' : 'text-ink-mut'
          }`}
        >
          LIVE
        </button>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-screen-sm rounded-t-2xl border-t border-hairline bg-surface-900 px-5 pt-5 pb-8 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-bold text-ink">Switch to mainnet?</h3>
            <p className="mt-2 text-sm text-ink-mut">
              Mainnet uses real Pi. You’ll be asked to sign in again under the new environment.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" className="w-full" onClick={confirmMainnet}>
                Switch to mainnet
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
