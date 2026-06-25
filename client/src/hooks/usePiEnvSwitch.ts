import { useCallback, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { usePiSDK } from '../providers/PiSDKProvider';
import { useToast } from '../components/ui/Toast';
import { getEnv, setEnv, usePiEnv, MAINNET_ENABLED, type PiEnv } from '../lib/piEnv';

/**
 * Orchestrates a TEST|LIVE environment switch end to end:
 *   gate mainnet → set env → re-init the Pi SDK under the new sandbox flag →
 *   re-authenticate → confirm. On any failure it reverts to the previous env
 *   and re-inits, so the SDK sandbox mode and the stored env never drift apart.
 *
 * Honesty rule: switching to mainnet while it is not genuinely enabled is
 * refused with a plain explanation — it never silently pretends to go live.
 */
export function usePiEnvSwitch() {
  const env = usePiEnv();
  const { signIn } = useAuth();
  const { reinit } = usePiSDK();
  const { success, error } = useToast();
  const [switching, setSwitching] = useState(false);

  const switchEnv = useCallback(
    async (next: PiEnv) => {
      const previous = getEnv();
      if (next === previous || switching) return;

      if (next === 'mainnet' && !MAINNET_ENABLED) {
        error('Mainnet isn’t enabled yet — it needs a Pi mainnet app registration. Staying on testnet.');
        return;
      }

      setSwitching(true);
      try {
        setEnv(next);
        await reinit(next);
        await signIn();
        success(next === 'mainnet' ? 'Switched to mainnet' : 'Switched to testnet');
      } catch {
        // Never leave a half-switched state — roll the env + SDK back together.
        setEnv(previous);
        const rollbackOk = await reinit(previous).then(() => true).catch(() => false);
        if (!rollbackOk) {
          // Rollback itself failed — the user must reload to recover a clean state.
          error(
            `Switch failed and rollback also failed. Please reload the page. ` +
              `(env stored as: ${previous})`,
          );
        } else {
          error(`Could not switch to ${next}. Reverted to ${previous}.`);
        }
      } finally {
        setSwitching(false);
      }
    },
    [error, reinit, signIn, success, switching],
  );

  return { env, switching, switchEnv };
}
