import { useEffect, useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { pirc2Api, statusApi, PiSubscription } from '../../lib/api';
import { PREMIUM_PRICE_PI } from '../../lib/constants';

const BILLING_INTERVAL_DAYS = 30;
const DEFAULT_CYCLES = 12;

/** Map subscription status to a badge variant + label. */
function statusBadge(status: string): { variant: 'premium' | 'default'; label: string } {
  switch (status) {
    case 'ACTIVE':
      return { variant: 'premium', label: 'Active' };
    case 'PAST_DUE':
      return { variant: 'default', label: 'Past due' };
    case 'CANCELLED':
      return { variant: 'default', label: 'Cancelled' };
    case 'EXPIRED':
      return { variant: 'default', label: 'Expired' };
    default:
      return { variant: 'default', label: status };
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface Pirc2SubscriptionProps {
  /** Called after a subscription change so the parent can refresh user data. */
  onChange?: () => void;
}

export default function Pirc2Subscription({ onChange }: Pirc2SubscriptionProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [subscription, setSubscription] = useState<PiSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [{ data: status }, { data: sub }] = await Promise.all([
        statusApi.get(),
        pirc2Api.current(),
      ]);
      setAvailable(status.integrations.pirc2);
      setSubscription(sub.subscription);
    } catch {
      setError('Failed to load subscription status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubscribe = async () => {
    setError('');
    if (!window.Pi) {
      setError('Pi SDK not available. Please open this app in Pi Browser.');
      return;
    }
    if (typeof window.Pi.createSubscription !== 'function') {
      setError(
        'Your Pi Browser version does not support PiRC2 recurring subscriptions yet.',
      );
      return;
    }
    setBusy(true);
    try {
      const approval = await window.Pi.createSubscription({
        amount: PREMIUM_PRICE_PI,
        interval: { days: BILLING_INTERVAL_DAYS },
        cycles: DEFAULT_CYCLES,
        memo: 'Cherri Hosting Premium — recurring',
        metadata: { plan: 'premium' },
      });
      const { data } = await pirc2Api.subscribe({
        approvalTxId: approval.txid,
        subscriberAddress: approval.address,
        amountPerCycle: PREMIUM_PRICE_PI,
        intervalDays: BILLING_INTERVAL_DAYS,
        cyclesAuthorized: DEFAULT_CYCLES,
      });
      setSubscription(data.subscription);
      onChange?.();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error)?.message ??
        'Failed to start subscription.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setError('');
    setBusy(true);
    try {
      await pirc2Api.cancel();
      await load();
      onChange?.();
    } catch {
      setError('Failed to cancel subscription.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-2">Recurring subscription</h2>
        <div className="space-y-2 animate-pulse">
          <div className="h-3.5 w-2/3 rounded bg-surface-800" />
          <div className="h-3.5 w-1/2 rounded bg-surface-800" />
        </div>
      </Card>
    );
  }

  const isLive =
    subscription &&
    ['ACTIVE', 'PAST_DUE'].includes(subscription.status);
  const badge = subscription ? statusBadge(subscription.status) : null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">Recurring subscription</h2>
        <Badge variant="default">PiRC2</Badge>
      </div>
      <p className="text-surface-500 text-[11px] leading-relaxed mb-3">
        PiRC2 is Pi Network's standard for auto-renewing payments — approve once,
        renew automatically.
      </p>

      {error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}

      {/* PiRC2 not configured on the server — honest "coming soon". */}
      {!available && !isLive && (
        <div className="space-y-2 text-sm">
          <p className="text-surface-400 text-xs leading-relaxed">
            Auto-renewing Premium via PiRC2 — Pi Network&apos;s on-chain
            subscription standard. You approve a spending allowance once and
            Premium renews automatically each cycle, with no repeated payment
            prompts.
          </p>
          <div className="mt-2 p-2 bg-surface-800/60 border border-surface-700 rounded-lg text-xs text-surface-400">
            Recurring subscriptions are coming soon. PiRC2 is currently in
            testnet ahead of Pi mainnet support. The one-time upgrade above is
            available now.
          </div>
        </div>
      )}

      {/* No active subscription, but PiRC2 is configured — allow subscribing. */}
      {available && !isLive && (
        <div className="space-y-3 text-sm">
          <p className="text-surface-400 text-xs leading-relaxed">
            Approve a one-time spending allowance and Premium renews
            automatically every {BILLING_INTERVAL_DAYS} days — up to{' '}
            {DEFAULT_CYCLES} cycles. Cancel anytime; access is revoked
            immediately and no further cycles are drawn.
          </p>
          <Button
            size="sm"
            className="w-full justify-center"
            onClick={handleSubscribe}
            isLoading={busy}
          >
            Subscribe ({PREMIUM_PRICE_PI} Pi / {BILLING_INTERVAL_DAYS} days)
          </Button>
        </div>
      )}

      {/* Active / past-due subscription details. */}
      {isLive && subscription && badge && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-surface-400 text-xs">Status</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">Per cycle</span>
            <span className="text-ink">
              {subscription.amountPerCycle} {subscription.currency} /{' '}
              {subscription.intervalDays} days
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">Cycles billed</span>
            <span className="text-ink">
              {subscription.cyclesBilled} / {subscription.cyclesAuthorized}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">Next billing</span>
            <span className="text-ink">{formatDate(subscription.nextBillingAt)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">Allowance left</span>
            <span className="text-ink">
              {subscription.allowanceRemaining} {subscription.currency}
            </span>
          </div>

          {subscription.status === 'PAST_DUE' && (
            <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
              Last billing cycle could not be drawn (insufficient funds). Premium
              access is paused.
            </div>
          )}

          {subscription.events.length > 0 && (
            <div className="pt-2 border-t border-surface-700">
              <p className="text-xs text-surface-500 mb-2">Recent activity</p>
              <ul className="space-y-1">
                {subscription.events.slice(0, 4).map((e) => (
                  <li key={e.id} className="flex items-center justify-between text-xs">
                    <span className="text-surface-400">
                      {e.type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span
                      className={
                        e.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      {formatDate(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            size="sm"
            variant="secondary"
            className="w-full justify-center"
            onClick={handleCancel}
            isLoading={busy}
          >
            Cancel subscription
          </Button>
        </div>
      )}
    </Card>
  );
}
