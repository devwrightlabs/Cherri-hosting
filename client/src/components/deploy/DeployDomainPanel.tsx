import { useState } from 'react';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { deploymentsApi, DomainTarget } from '../../lib/api';
import { Deployment } from '../../types';

interface DeployDomainPanelProps {
  /** The freshly published, ACTIVE deployment to point a .pi domain at. */
  deployment: Deployment;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { success, error } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      success(`${label} copied`);
    } catch {
      error('Could not copy — select the text and copy it manually.');
    }
  };
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-mut mb-1">{label}</p>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 min-w-0 rounded-lg bg-surface-900 border border-hairline px-3 py-2 flex items-center">
          <span className="font-mono text-xs text-ink break-all">{value}</span>
        </div>
        <Button variant="secondary" size="md" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
    </div>
  );
}

export default function DeployDomainPanel({ deployment }: DeployDomainPanelProps) {
  const [domain, setDomain] = useState('');
  const [target, setTarget] = useState<DomainTarget | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const dnslink = `dnslink=/ipfs/${deployment.cid}`;
  const entered = domain.trim().length > 0;

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyError('');
    setTarget(null);
    try {
      const { data } = await deploymentsApi.domainTarget(deployment.id);
      setTarget(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not verify this deployment right now. Please try again.';
      setVerifyError(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-800 border border-hairline p-4">
      <h3 className="text-sm font-semibold text-ink">Your hosted link</h3>
      <p className="text-ink-mut text-xs mt-1 leading-relaxed">
        This permanent link is your site, live on IPFS. Paste it into the Pi Developer Portal
        to register your app, or use it below to point an existing <span className="font-mono">.pi</span> domain
        here.
      </p>

      <div className="mt-3 space-y-3">
        <CopyRow label="Site address (gateway)" value={deployment.gateway} />

        <div className="border-t border-hairline pt-3 space-y-2">
          <Button
            size="lg"
            className="w-full justify-center"
            isLoading={isVerifying}
            onClick={() => void handleVerify()}
          >
            {target ? 'Re-check it’s live' : 'Verify my site is live'}
          </Button>

          {target && (
            <>
              {target.served ? (
                <p className="text-live text-xs leading-relaxed">
                  ✓ Live on IPFS — we checked your link and your site loaded. Pointing your{' '}
                  <span className="font-mono">.pi</span> name here is still done in Pi’s portal;
                  Cherri can’t verify <span className="font-mono">.pi</span> resolution.
                </p>
              ) : target.indeterminate ? (
                <p className="text-ink-mut text-xs leading-relaxed">
                  Couldn’t verify right now — {target.reason ?? 'the gateway did not respond in time.'}{' '}
                  This doesn’t mean your site is down; try again in a moment.
                </p>
              ) : (
                <p className="text-amber-400 text-xs leading-relaxed">
                  Not loading yet — we checked your link and the site didn’t come up.{' '}
                  {target.reason ?? 'The gateway hasn’t picked up your content yet — give it a minute.'}
                </p>
              )}
            </>
          )}

          {verifyError && <p className="text-red-400 text-xs">{verifyError}</p>}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-hairline">
        <h4 className="text-sm font-semibold text-ink">Already own a .pi domain?</h4>
        <p className="text-ink-mut text-xs mt-1 leading-relaxed">
          Pi’s domain auction is closed and isn’t taking new registrations. If you already won a{' '}
          <span className="font-mono">.pi</span> domain before it closed, enter it below to get the
          value to paste into Pi’s portal — that link-up happens on Pi’s side, not here. No domain
          yet? The link above already works for the Pi Developer Portal on its own.
        </p>

        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="your-domain.pi"
          className="mt-3 w-full min-h-[48px] bg-surface-900 border border-surface-600 rounded-xl px-4 text-ink text-sm font-mono placeholder:text-ink-mut placeholder:font-sans focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 focus:ring-offset-2 focus:ring-offset-surface-950 transition-colors"
        />

        {entered && (
          <div className="mt-3">
            <CopyRow label="DNSLink TXT value" value={dnslink} />
          </div>
        )}
      </div>
    </div>
  );
}
