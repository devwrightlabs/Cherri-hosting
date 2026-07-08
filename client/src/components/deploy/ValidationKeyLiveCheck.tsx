import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button';
import {
  checkValidationKey,
  extractDeployError,
  type ValidationKeyCheck,
} from '../../api/deployApi';

interface ValidationKeyLiveCheckProps {
  /** The freshly published, ACTIVE deployment to check. */
  deploymentId: string;
  /**
   * The key pasted during THIS session, if any. With it we can confirm the
   * served file matches; without it we honestly report reachability only.
   */
  expectedKey: string | null;
}

/**
 * Post-deploy confirmation that `<site>/validation-key.txt` is genuinely being
 * served by the public gateway. Runs a REAL fetch server-side — never claims
 * "verified" from local state. Mirrors the 3-state honesty of the domain
 * check: served / not served / couldn't verify right now.
 */
export default function ValidationKeyLiveCheck({
  deploymentId,
  expectedKey,
}: ValidationKeyLiveCheckProps) {
  const [check, setCheck] = useState<ValidationKeyCheck | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');
  const ranRef = useRef(false);

  const run = async () => {
    setIsChecking(true);
    setError('');
    try {
      setCheck(await checkValidationKey(deploymentId, expectedKey ?? undefined));
    } catch (err: unknown) {
      setError(extractDeployError(err).message);
    } finally {
      setIsChecking(false);
    }
  };

  // Auto-run once when the panel first appears — the whole point is to confirm
  // the file the user just added actually made it to the live site.
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  return (
    <div className="rounded-xl bg-surface-800 border border-hairline p-4">
      <h3 className="text-sm font-semibold text-ink">Validation key on your live site</h3>
      <p className="text-ink-mut text-xs mt-1 leading-relaxed">
        Pi verifies your <span className="font-mono">.pi</span> domain by fetching{' '}
        <span className="font-mono">/validation-key.txt</span> from your site. This checks the
        real file on the public gateway.
      </p>

      <div className="mt-3 space-y-2">
        {isChecking && (
          <div className="flex items-center gap-2.5">
            <span className="w-4 h-4 border-2 border-cherry-300 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-ink-mut text-xs">Fetching your live validation key…</p>
          </div>
        )}

        {!isChecking && check && (
          <>
            {check.served && check.matches === true && (
              <p className="text-live text-xs leading-relaxed">
                ✓ Live and correct — the gateway served your validation key and it matches what
                you pasted. Finish verification in Pi&rsquo;s developer portal.
              </p>
            )}
            {check.served && check.matches === false && (
              <p className="text-amber-400 text-xs leading-relaxed">
                The gateway serves a validation-key.txt, but its content doesn&rsquo;t match the
                key you pasted this session. If you re-deployed an older build, add the key again
                and re-deploy.
              </p>
            )}
            {check.served && check.matches === null && (
              <p className="text-live text-xs leading-relaxed">
                ✓ Your site serves a validation-key.txt. Cherri couldn&rsquo;t compare its content
                (no key was pasted this session) — Pi&rsquo;s portal does the authoritative check.
              </p>
            )}
            {!check.served && check.indeterminate && (
              <p className="text-ink-mut text-xs leading-relaxed">
                Couldn&rsquo;t verify right now —{' '}
                {check.reason ?? 'the gateway did not respond in time.'} This doesn&rsquo;t mean
                the file is missing; try again in a moment.
              </p>
            )}
            {!check.served && !check.indeterminate && (
              <p className="text-amber-400 text-xs leading-relaxed">
                Not served yet{check.status ? ` (HTTP ${check.status})` : ''}.{' '}
                {check.reason ?? 'The gateway hasn’t picked it up yet — give it a minute.'}
              </p>
            )}
          </>
        )}

        {!isChecking && error && <p className="text-red-400 text-xs">{error}</p>}

        {!isChecking && (
          <Button
            variant="secondary"
            size="md"
            className="w-full justify-center"
            onClick={() => void run()}
          >
            {check || error ? 'Re-check' : 'Check now'}
          </Button>
        )}
      </div>
    </div>
  );
}
