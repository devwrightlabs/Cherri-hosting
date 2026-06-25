import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import LogoMark from '../components/ui/LogoMark';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { subscriptionsApi, extractApiError } from '../lib/api';
import { getEnv } from '../lib/piEnv';
import { useAuth } from '../providers/AuthProvider';
import { Subscription } from '../types';
import {
  TIER1_PRICE_PI,
  TIER2_PRICE_PI,
  TIER3_PRICE_PI,
  ANNUAL_MULTIPLIER,
  TIER_LABELS,
  TIER_STORAGE_LABELS,
} from '../lib/constants';

interface SubscriptionData {
  subscription: Subscription | null;
  user: { tier: string; storageUsed: number; storageLimit: number } | null;
}

interface TierFeature {
  label: string;
  /** Not yet shipped — rendered muted with a "Soon" chip so cards stay honest. */
  soon?: boolean;
}

interface TierDef {
  key: string;
  /** Identity name shown as the card title (Starter / Builder / Pro / Business). */
  name: string;
  /** Outcome eyebrow above the name (Go live / Make it yours / …). */
  eyebrow: string;
  price: number;
  /** One-line pitch under the price. */
  headline: string;
  features: TierFeature[];
  /** The Pi payment fee line — the upgrade driver, always shown. */
  feeLine: string;
  /** Render the fee line in --live green (Business only) instead of ink. */
  feeGreen?: boolean;
  cta: string;
  popular?: boolean;
}

/**
 * Rank used to decide whether a tier is an upgrade from the current plan.
 * Drives which cards get a payment CTA (only strictly-higher tiers).
 */
const TIER_RANK: Record<string, number> = {
  FREE: 0,
  PREMIUM: 1,
  TIER1: 1,
  TIER2: 2,
  TIER3: 3,
  TIER4: 4,
};

/**
 * The four tiers from the master prompt, mapped onto the existing server tier
 * keys so the Pi amount → tier resolution (resolveTierFromAmount) keeps working.
 * Starter→FREE, Builder→TIER1, Pro→TIER2 (35π, most popular), Business→TIER3.
 * Quotas mirror the enforced limits in TIER_STORAGE_LABELS; prices are tunable.
 */
const TIERS: TierDef[] = [
  {
    key: 'FREE',
    name: 'Starter',
    eyebrow: 'Go live',
    price: 0,
    headline: 'A real site on the permanent web — free, in seconds.',
    features: [
      { label: '1 project' },
      { label: 'Unlimited deployments' },
      { label: '500 MB storage' },
      { label: 'IPFS gateway URLs' },
      { label: 'Community support' },
    ],
    feeLine: 'Accept Pi payments — 5% fee',
    cta: 'Get started free',
  },
  {
    key: 'TIER1',
    name: 'Builder',
    eyebrow: 'Make it yours',
    price: TIER1_PRICE_PI,
    headline: 'Your own Pi domain, and your site stays online — guaranteed.',
    features: [
      { label: '3 projects' },
      { label: 'Unlimited deployments' },
      { label: '2 GB storage' },
      { label: '1 Pi domain', soon: true },
      { label: 'Priority IPFS pinning' },
      { label: 'Email support' },
    ],
    feeLine: 'Accept Pi payments — 3% fee, more in your pocket',
    cta: 'Upgrade with Pi',
  },
  {
    key: 'TIER2',
    name: 'Pro',
    eyebrow: 'Make it permanent',
    price: TIER2_PRICE_PI,
    headline: "Permanent storage, real analytics, faster — your work can't disappear.",
    features: [
      { label: 'Unlimited projects' },
      { label: '10 GB storage' },
      { label: '5 Pi domains', soon: true },
      { label: 'Filecoin permanence', soon: true },
      { label: 'Full analytics dashboard', soon: true },
      { label: 'Priority support' },
    ],
    feeLine: 'Accept Pi payments — 1.5% fee + paywall tools',
    cta: 'Upgrade with Pi',
    popular: true,
  },
  {
    key: 'TIER3',
    name: 'Business',
    eyebrow: 'Make money & scale',
    price: TIER3_PRICE_PI,
    headline: 'Team, API, lowest Pi fees, and a featured spot in the marketplace.',
    features: [
      { label: 'Unlimited projects' },
      { label: '50 GB storage' },
      { label: 'Unlimited Pi domains', soon: true },
      { label: 'Team members + RBAC roles', soon: true },
      { label: 'API access + CLI', soon: true },
      { label: 'Featured marketplace listing', soon: true },
    ],
    feeLine: 'Accept Pi payments — best rate, 0.5%',
    feeGreen: true,
    cta: 'Upgrade with Pi',
  },
];

const FAQ = [
  {
    q: 'What is Pi Network?',
    a: 'Pi Network is a digital currency project that lets you mine Pi on your phone. Visit minepi.com to learn more.',
  },
  {
    q: 'How does IPFS hosting work?',
    a: 'Your files are uploaded and pinned on the InterPlanetary File System — a peer-to-peer storage network. Every deployment gets a unique content-addressed URL (CID) that is permanent.',
  },
  {
    q: 'Can I use a custom domain?',
    a: "Domains are acquired through Pi Network's official domain auction — Cherri does not sell domains. Once you own a Pi domain, any paid tier lets you map it to your deployment.",
  },
  {
    q: 'What if I exceed my storage?',
    a: 'New deployments pause until you upgrade or free up space. Your existing deployments stay live on IPFS.',
  },
  {
    q: 'Can I upload entire project folders?',
    a: 'Yes. The deploy panel accepts full folder drag-and-drop or a ZIP archive. The directory structure is preserved on IPFS.',
  },
];

export default function Pricing() {
  const { user, isAuthenticated, refreshUser, signOut } = useAuth();
  const { success, error: toastError } = useToast();
  const [subData, setSubData] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [payingTier, setPayingTier] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    subscriptionsApi
      .current()
      .then((res) => setSubData(res.data as SubscriptionData))
      .catch((err) => {
        toastError(extractApiError(err, 'Could not load your plan. Please refresh.'));
      })
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, toastError]);

  const currentTier = subData?.user?.tier ?? user?.tier ?? 'FREE';

  const handleUpgrade = (
    tierKey: string,
    amount: number,
    tierLabel: string,
    months: number,
  ) => {
    if (!window.Pi) {
      toastError('Open this app in Pi Browser to pay with Pi.');
      return;
    }
    setPayingTier(tierKey);
    const env = getEnv();
    const periodLabel = months === 12 ? '1 year' : '1 month';

    window.Pi.createPayment(
      {
        amount,
        memo: `Cherri Hosting ${tierLabel} — ${periodLabel}`,
        metadata: { plan: tierKey.toLowerCase(), tier: tierKey, months, env },
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          try {
            await subscriptionsApi.approvePayment(paymentId, env);
          } catch {
            toastError('We could not approve the payment. Please try again.');
            setPayingTier(null);
          }
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          try {
            await subscriptionsApi.completePayment(paymentId, txid, amount, env);
            const res = await subscriptionsApi.current();
            setSubData(res.data as SubscriptionData);
            await refreshUser?.();
            success(`You're on ${tierLabel}`);
          } catch {
            toastError('Payment recorded but activation failed. Please contact support.');
          } finally {
            setPayingTier(null);
          }
        },
        onCancel: () => setPayingTier(null),
        onError: (err) => {
          toastError(err.message ?? 'Payment failed');
          setPayingTier(null);
        },
      },
    );
  };

  const body = (
    <>
      {/* Account summary (signed in) */}
      {isAuthenticated && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-11 h-11 rounded-full bg-surface-800 border border-hairline text-ink-mut">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-ink font-semibold truncate">
                {user?.username ?? 'Your account'}
              </p>
              <div className="mt-0.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-live/30 bg-live/10 px-2 py-0.5 text-xs font-medium text-live">
                  {TIER_LABELS[currentTier] ?? currentTier} · your plan
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={signOut}
            >
              Sign out
            </Button>
          </div>
        </Card>
      )}

      <div>
        <h1 className="text-xl font-bold text-ink font-display tracking-tight">
          {isAuthenticated ? 'Plans' : 'Simple, Pi-powered pricing'}
        </h1>
        <p className="text-ink-mut text-sm mt-0.5">
          Pay with Pi. No credit cards. Cancel anytime.
        </p>
      </div>

      {isAuthenticated && isLoading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      {/* Billing period toggle — neutral styling so gold stays reserved for Pro */}
      <div className="space-y-2">
        <div className="flex items-center justify-center">
          <div className="inline-flex rounded-full border border-hairline bg-surface-900 p-0.5">
            {(['monthly', 'annual'] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setBillingPeriod(period)}
                aria-pressed={billingPeriod === period}
                className={`rounded-full px-5 py-1.5 text-sm font-medium transition-colors ${
                  billingPeriod === period
                    ? 'bg-surface-800 text-ink'
                    : 'text-ink-mut hover:text-ink'
                }`}
              >
                {period === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        </div>
        {billingPeriod === 'annual' && (
          <p className="text-center text-xs text-live">Two months free, billed yearly</p>
        )}
      </div>

      {/* Tier cards — single column, four tiers */}
      <div className="space-y-4">
        {TIERS.map((tier) => {
          const isCurrentTier = currentTier === tier.key;
          const isPaidAndActive = isCurrentTier && tier.key !== 'FREE';
          const canUpgrade =
            (TIER_RANK[tier.key] ?? 0) > (TIER_RANK[currentTier] ?? 0);

          const inner = (
            <TierCardContent
              tier={tier}
              billingPeriod={billingPeriod}
              isCurrentTier={isCurrentTier}
              isPaidAndActive={isPaidAndActive}
              isAuthenticated={isAuthenticated}
              canUpgrade={canUpgrade}
              payingTier={payingTier}
              onUpgrade={handleUpgrade}
            />
          );

          // Pro is the highlighted tier — the one sanctioned gold zone on this
          // screen (gold border + Most popular badge + gold CTA).
          if (tier.popular) {
            return (
              <div
                key={tier.key}
                className="relative bg-gold-gradient p-px rounded-2xl shadow-gold"
              >
                <span className="absolute -top-2 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-surface-950">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 7.1-1.01z" />
                  </svg>
                  Most popular
                </span>
                <div className="bg-surface-900 rounded-[15px] p-5 flex flex-col gap-4">{inner}</div>
              </div>
            );
          }

          return (
            <Card
              key={tier.key}
              className={`flex flex-col gap-4 ${isCurrentTier ? 'border-live/40' : ''}`}
            >
              {inner}
            </Card>
          );
        })}
      </div>

      {/* Current plan banner */}
      {isAuthenticated && !isLoading && currentTier !== 'FREE' && (
        <Card className="border-live/30 text-center py-5">
          <p className="text-ink font-semibold">
            You're on {TIER_LABELS[currentTier] ?? currentTier}{' '}
            <span className="text-ink-mut font-normal">
              ({TIER_STORAGE_LABELS[currentTier] ?? ''} storage)
            </span>
          </p>
          {subData?.subscription && (
            <p className="text-ink-mut text-sm mt-1">
              Active until {new Date(subData.subscription.periodEnd).toLocaleDateString()}
            </p>
          )}
        </Card>
      )}

      {/* FAQ */}
      <div className="space-y-3 pt-2">
        <h2 className="text-base font-semibold text-ink font-display">FAQ</h2>
        {FAQ.map(({ q, a }) => (
          <Card key={q}>
            <p className="font-medium text-ink mb-1">{q}</p>
            <p className="text-ink-mut text-sm">{a}</p>
          </Card>
        ))}
      </div>
    </>
  );

  // Signed in → render inside the mobile shell as the Account tab.
  if (isAuthenticated) {
    return <AppShell title="Account">{body}</AppShell>;
  }

  // Public pricing page (pre-auth) → standalone mobile layout, no tab bar.
  return (
    <div className="min-h-[100dvh] bg-surface-950">
      <header className="safe-top bg-surface-950/90 backdrop-blur-md border-b border-hairline">
        <div className="h-14 px-4 flex items-center max-w-screen-sm mx-auto">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark size={26} />
            <span className="font-display font-bold text-ink text-[15px] tracking-tight">
              Cherri Hosting
            </span>
          </Link>
        </div>
      </header>
      <main className="max-w-screen-sm mx-auto px-4 pt-4 pb-12 space-y-5 animate-fade-in">
        {body}
      </main>
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface TierCardContentProps {
  tier: TierDef;
  billingPeriod: 'monthly' | 'annual';
  isCurrentTier: boolean;
  isPaidAndActive: boolean;
  isAuthenticated: boolean;
  canUpgrade: boolean;
  payingTier: string | null;
  onUpgrade: (key: string, amount: number, label: string, months: number) => void;
}

function TierCardContent({
  tier,
  billingPeriod,
  isCurrentTier,
  isPaidAndActive,
  isAuthenticated,
  canUpgrade,
  payingTier,
  onUpgrade,
}: TierCardContentProps) {
  // Business renders its fee line in --live green; the rest stay ink so gold
  // is reserved for the highlighted Pro card only.
  const feeClass = tier.feeGreen ? 'text-live' : 'text-ink';

  // Annual plans bill 10× monthly (two months free). The displayed price is the
  // exact amount charged, preserving the "displayed price == payment amount" rule.
  const isAnnual = billingPeriod === 'annual';
  const isPaid = tier.price > 0;
  const displayPrice = isPaid && isAnnual ? tier.price * ANNUAL_MULTIPLIER : tier.price;
  const periodSuffix = isAnnual ? '/yr' : '/mo';
  const months = isAnnual ? 12 : 1;

  return (
    <>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mut">
          {tier.eyebrow}
        </p>
        <h2 className="text-lg font-bold text-ink font-display mt-0.5">{tier.name}</h2>
        <div className="flex items-baseline gap-1 mt-1.5">
          {tier.price === 0 ? (
            <span className="text-3xl font-bold text-ink font-display">Free</span>
          ) : (
            <>
              <span className="text-3xl font-bold text-ink font-display">{displayPrice}</span>
              <span className="text-lg font-mono text-ink">π</span>
              <span className="text-ink-mut text-sm ml-0.5">{periodSuffix}</span>
            </>
          )}
        </div>
        {isPaid && isAnnual && (
          <p className="text-ink-mut text-xs mt-1">
            <span className="font-mono">{tier.price} π</span>/mo billed yearly
          </p>
        )}
        <p className="text-ink-mut text-sm mt-2 leading-snug">{tier.headline}</p>
      </div>

      <ul className="space-y-2 flex-1">
        {tier.features.map((f) => (
          <li key={f.label} className="flex items-center gap-2 text-sm">
            <span className={`shrink-0 ${f.soon ? 'text-ink-mut' : 'text-live'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className={f.soon ? 'text-ink-mut' : 'text-ink'}>{f.label}</span>
            {f.soon && (
              <span className="ml-auto shrink-0 rounded-full border border-hairline px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-mut">
                Soon
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Fee line — the upgrade driver, always shown */}
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-800/60 px-3 py-2">
        <span className={`shrink-0 ${feeClass}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="5" x2="5" y2="19" />
            <circle cx="6.5" cy="6.5" r="2.5" />
            <circle cx="17.5" cy="17.5" r="2.5" />
          </svg>
        </span>
        <span className={`text-xs ${feeClass}`}>{tier.feeLine}</span>
      </div>

      {isAuthenticated ? (
        isCurrentTier ? (
          <Badge variant={tier.key === 'FREE' ? 'default' : 'success'} className="self-start">
            {isPaidAndActive ? 'Active plan' : 'Current plan'}
          </Badge>
        ) : canUpgrade ? (
          <Button
            variant={tier.popular ? 'primary' : 'secondary'}
            className="w-full justify-center"
            onClick={() => onUpgrade(tier.key, displayPrice, tier.name, months)}
            isLoading={payingTier === tier.key}
            disabled={payingTier !== null && payingTier !== tier.key}
          >
            {tier.cta}
          </Button>
        ) : null
      ) : (
        <Link to="/">
          <Button
            variant={tier.popular ? 'primary' : 'secondary'}
            className="w-full justify-center"
          >
            {tier.price === 0 ? tier.cta : 'Sign in to upgrade'}
          </Button>
        </Link>
      )}
    </>
  );
}
