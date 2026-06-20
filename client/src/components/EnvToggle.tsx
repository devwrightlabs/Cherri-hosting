import { useState } from 'react';
import { usePiEnvSwitch } from '../hooks/usePiEnvSwitch';
import { ALLOW_ENV_TOGGLE, type PiEnv } from '../lib/piEnv';
import Button from './ui/Button';

/**
 * Segmented TEST|LIVE control for the top bar.
 *
 * Rules (per master prompt FIX 2):
 * - Switching TO testnet is instant — no confirmation, no sheet.
 * - Switching TO mainnet raises a compact bottom sheet. The header + this
 *   toggle stay visible above the sheet at all times (overlay is z-40,
 *   TopBar is z-50).
 * - The sheet never takes over the full screen. No "Cancel" only. No navigation.
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
    // Switching back to TEST is always instant — safe environment, no confirm.
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

      {/* Compact bottom sheet — z-40 so the TopBar (z-50) stays above it */}
      {confirmOpen && (
        <>
          {/* Backdrop — covers content below the header but not the header itself */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setConfirmOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="env-confirm-title"
            className="fixed inset-x-0 bottom-0 z-40 w-full max-w-screen-sm mx-auto rounded-t-2xl border-t border-hairline bg-surface-900 px-5 pt-5 pb-8 safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="env-confirm-title"
              className="font-display text-lg font-bold text-ink"
            >
              Switch to mainnet?
            </h3>
            <p className="mt-2 text-sm text-ink-mut leading-relaxed">
              Mainnet uses real Pi. You'll be signed in again under the new
              environment. Tap TEST at any time to switch back instantly.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" className="w-full" onClick={confirmMainnet}>
                Switch to LIVE
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setConfirmOpen(false)}
              >
                Stay on TEST
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
