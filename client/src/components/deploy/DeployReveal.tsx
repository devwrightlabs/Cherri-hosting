import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Button from '../ui/Button';
import ProgressBar from '../ui/ProgressBar';
import { useToast } from '../ui/Toast';
import { verifyLive } from '../../api/deployApi';
import { Deployment, DeploymentStatus, LiveCheckStatus } from '../../types';

type Phase = 'uploading' | 'pinning' | 'sealing' | 'live' | 'failed';

interface DeployRevealProps {
  status: DeploymentStatus;
  isUploading: boolean;
  uploadProgress: number;
  deployment: Deployment | null;
  startedAt: number | null;
  onRetry: () => void;
  onReset: () => void;
  /** If the project has a .pi custom domain, show a DNSLink stale warning after redeploy. */
  customDomain?: string;
}

const STEPS = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'pinning', label: 'Pinning' },
  { key: 'sealing', label: 'Sealing' },
] as const;

const STEP_INDEX: Record<Exclude<Phase, 'live' | 'failed'>, number> = {
  uploading: 0,
  pinning: 1,
  sealing: 2,
};

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ShieldStamp() {
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      <span className="absolute inset-0 rounded-full bg-gold/30 reveal-ring" />
      <span className="absolute inset-0 rounded-full bg-gold/20 reveal-ring" style={{ animationDelay: '0.35s' }} />
      <span className="relative flex items-center justify-center w-20 h-20 rounded-full bg-gold-gradient shadow-gold animate-stamp text-surface-950">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 4 5v6c0 4.5 3.1 8.3 8 11 4.9-2.7 8-6.5 8-11V5z" fill="currentColor" fillOpacity="0.18" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
    </div>
  );
}

export default function DeployReveal({
  status,
  isUploading,
  uploadProgress,
  deployment,
  startedAt,
  onRetry,
  onReset,
  customDomain,
}: DeployRevealProps) {
  const { success, error: toastError } = useToast();
  const [phase, setPhase] = useState<Phase>('uploading');
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Result of a manual "Check again" — overrides the polled deployment prop.
  const [rechecked, setRechecked] = useState<Deployment | null>(null);
  const [isRechecking, setIsRechecking] = useState(false);

  // A new deployment invalidates any previous manual re-check result.
  useEffect(() => {
    setRechecked(null);
  }, [deployment?.id]);

  const runRecheck = async (id: string) => {
    setIsRechecking(true);
    try {
      setRechecked(await verifyLive(id));
    } catch {
      toastError('Could not run the link check — please try again.');
    } finally {
      setIsRechecking(false);
    }
  };

  useEffect(() => {
    if (status === 'FAILED') {
      setPhase('failed');
      return;
    }
    if (status === 'ACTIVE' && deployment) {
      setPhase('sealing');
      const t = setTimeout(() => {
        setPhase('live');
        if (startedAt) setElapsed((Date.now() - startedAt) / 1000);
      }, 900);
      return () => clearTimeout(t);
    }
    if (status === 'PINNING') {
      setPhase('pinning');
      return;
    }
    setPhase('uploading');
  }, [status, deployment, startedAt]);

  // ── Failed ────────────────────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <div className="rounded-2xl bg-surface-900 border border-hairline p-5 text-center">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15 text-red-400 mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </span>
        <h3 className="text-base font-semibold text-ink font-display">Deployment failed</h3>
        <p className="text-ink-mut text-sm mt-1 break-words">
          {deployment?.failureReason ??
            'Something went wrong while sealing your site. You can try again.'}
        </p>
        <div className="flex gap-2 justify-center mt-4">
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
          <Button size="sm" variant="secondary" onClick={onReset}>
            Reset
          </Button>
        </div>
      </div>
    );
  }

  // ── Live reveal ─────────────────────────────────────────────────────────────
  if (phase === 'live' && deployment) {
    // A manual re-check result supersedes the polled prop.
    const dep = rechecked ?? deployment;
    const gateway = dep.gateway;
    const liveCheck: LiveCheckStatus = dep.liveCheckStatus ?? 'UNCHECKED';
    const isVerified = liveCheck === 'VERIFIED';

    return (
      <div className="rounded-2xl bg-surface-900 border border-gold/25 p-5 flex flex-col items-center text-center">
        <ShieldStamp />

        <h3 className="mt-4 text-lg font-bold text-ink font-display reveal-item" style={{ animationDelay: '0.45s' }}>
          {isVerified ? 'Your site is live' : 'Published to the permanent web'}
        </h3>
        <p className="text-ink-mut text-sm mt-1 reveal-item" style={{ animationDelay: '0.55s' }}>
          {isVerified
            ? `${elapsed != null ? `Live in ${elapsed.toFixed(1)}s · ` : ''}we opened your link and your site rendered.`
            : "Your files are safely stored and can't be taken down."}
        </p>

        {gateway && (
          <>
            <div
              className="mt-5 w-full bg-white p-2.5 rounded-xl reveal-item"
              style={{ animationDelay: '0.65s', maxWidth: 168 }}
            >
              <QRCodeSVG value={gateway} size={144} bgColor="#ffffff" fgColor="#0f1117" level="M" className="w-full h-auto" />
            </div>

            <div
              className="mt-5 w-full flex items-stretch gap-2 reveal-item"
              style={{ animationDelay: '0.75s' }}
            >
              <div className="flex-1 min-w-0 rounded-lg bg-surface-800 border border-hairline px-3 py-2.5 flex items-center">
                <span className="font-mono text-xs text-ink truncate">{gateway}</span>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(gateway);
                  success('Copied');
                }}
              >
                Copy
              </Button>
            </div>
          </>
        )}

        {/* Honest live-link state — never celebrate an unverified link. */}
        <div className="mt-4 w-full reveal-item text-left" style={{ animationDelay: '0.78s' }}>
          {liveCheck === 'VERIFIED' && (
            <div className="flex items-center gap-2 rounded-xl bg-live/10 border border-live/30 px-4 py-3">
              <span className="text-live shrink-0">
                <CheckIcon size={16} />
              </span>
              <p className="text-xs text-ink">
                Link checked — it opens your site.
              </p>
            </div>
          )}
          {liveCheck === 'UNCHECKED' && (
            <div className="rounded-xl bg-surface-800 border border-hairline px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="w-3.5 h-3.5 shrink-0 border-2 border-ink-mut border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-ink-mut">
                  Checking that your link opens your site…
                </p>
              </div>
              {/* Escape hatch — the spinner must never be a dead end. */}
              <Button
                size="sm"
                variant="secondary"
                className="mt-2.5"
                disabled={isRechecking}
                onClick={() => void runRecheck(dep.id)}
              >
                {isRechecking ? 'Checking…' : 'Check now'}
              </Button>
            </div>
          )}
          {liveCheck === 'INDETERMINATE' && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3">
              <p className="text-xs font-semibold text-amber-400 mb-1">
                Couldn't confirm your link yet
              </p>
              <p className="text-xs text-ink-mut mb-2.5">
                {dep.liveCheckDetail ??
                  'The link could not be confirmed yet — it may still be propagating.'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={isRechecking}
                onClick={() => void runRecheck(dep.id)}
              >
                {isRechecking ? 'Checking…' : 'Check again'}
              </Button>
            </div>
          )}
          {liveCheck === 'FAILED' && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
              <p className="text-xs font-semibold text-red-400 mb-1">
                The link doesn't open your site yet
              </p>
              <p className="text-xs text-ink-mut mb-2.5">
                {dep.liveCheckDetail ??
                  'The gateway did not return your site when we checked this link.'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={isRechecking}
                onClick={() => void runRecheck(dep.id)}
              >
                {isRechecking ? 'Checking…' : 'Check again'}
              </Button>
            </div>
          )}
        </div>

        <p
          className="mt-3 font-mono text-[11px] text-ink-mut break-all reveal-item"
          style={{ animationDelay: '0.8s' }}
        >
          {dep.cid}
        </p>

        {customDomain && (
          <div
            className="mt-4 w-full rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-left reveal-item"
            style={{ animationDelay: '0.85s' }}
          >
            <p className="text-xs font-semibold text-amber-400 mb-1">
              DNSLink record stale
            </p>
            <p className="text-xs text-ink-mut mb-2">
              Your <span className="font-mono text-ink">{customDomain}</span> domain
              still points to the old CID. Update your DNSLink TXT record to:
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 min-w-0 font-mono text-[11px] bg-surface-800 border border-hairline rounded-lg px-2 py-1.5 text-ink break-all">
                dnslink=/ipfs/{dep.cid}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(`dnslink=/ipfs/${dep.cid}`);
                  success('Copied');
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 w-full space-y-2 reveal-item" style={{ animationDelay: '0.9s' }}>
          {gateway && (
            <Button
              size="lg"
              variant={liveCheck === 'FAILED' ? 'secondary' : 'primary'}
              className="w-full justify-center"
              onClick={() => window.open(gateway, '_blank', 'noopener,noreferrer')}
            >
              {isVerified
                ? 'Open your site ↗'
                : liveCheck === 'FAILED'
                  ? 'Open link anyway ↗'
                  : 'Open link ↗'}
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-center" onClick={onReset}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  // ── In-progress (uploading / pinning / sealing) ──────────────────────────────
  const activeIndex = STEP_INDEX[phase as Exclude<Phase, 'live' | 'failed'>];
  const label =
    phase === 'pinning'
      ? 'Pinning to IPFS…'
      : phase === 'sealing'
      ? 'Sealing…'
      : !isUploading
      ? 'Uploading files…'
      : uploadProgress > 0
      ? `Uploading files… ${uploadProgress}%`
      : 'Preparing…';
  // Staged fill so the bar climbs through the sequence (Part 3): the real upload
  // byte-progress drives the first leg, then pinning/sealing advance toward 100%.
  const progressValue =
    phase === 'sealing'
      ? 95
      : phase === 'pinning'
      ? 85
      : isUploading
      ? Math.max(4, Math.round(uploadProgress * 0.6))
      : 60;

  return (
    <div className="rounded-2xl bg-surface-900 border border-hairline p-5">
      <ProgressBar value={progressValue} tone="live" className="mb-1" />
      <p className="text-sm font-medium text-ink mt-3">{label}</p>
      <p className="text-ink-mut text-xs mt-0.5">
        Your files are being published to the decentralised web.
      </p>

      {/* Three step indicators */}
      <div className="flex items-start mt-5">
        {STEPS.map((step, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          return (
            <div key={step.key} className="flex items-start flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold border transition-colors ${
                    isDone
                      ? 'bg-live/15 border-live/40 text-live'
                      : isActive
                      ? 'border-ink/50 text-ink'
                      : 'border-surface-600 text-ink-mut'
                  }`}
                >
                  {isDone ? (
                    <CheckIcon />
                  ) : isActive ? (
                    <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={`text-[10px] ${isActive ? 'text-ink' : 'text-ink-mut'}`}>
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-px mt-4 mx-1 bg-surface-700 relative overflow-hidden">
                  <div
                    className={`absolute inset-0 bg-live transition-transform duration-500 origin-left ${
                      isDone ? 'scale-x-100' : 'scale-x-0'
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
