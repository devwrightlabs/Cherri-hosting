import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import LogoMark from '../components/ui/LogoMark';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import Spinner from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { subscriptionsApi, billingApi, extractApiError } from '../lib/api';
import { getEnv } from '../lib/piEnv';
import { useAuth } from '../providers/AuthProvider';
import { Subscription } from '../types';
import { ANNUAL_MULTIPLIER, TIER_LABELS, TIER_STORAGE_LABELS } from '../lib/constants';

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
  /**
   * Catalog plan key driving the live Pi quote (BUILDER / PRO / TIER4). Absent
   * on Free, which is never charged.
   */
  catalogKey?: string;
  /** Monthly dollar anchor in whole US dollars. 0 for Free. */
  usd: number;
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
 * keys (Starter→FREE, Builder→TIER1, Pro→TIER2, Business→TIER3) so entitlement
 * enforcement is unchanged. Each PAID tier carries a dollar anchor (`usd`) shown
 * instantly, plus a `catalogKey` used to fetch the LIVE Pi amount it's pegged to
 * — Pi is the headline, the dollar value is the peg beneath it.
 */
const TIERS: TierDef[] = [
  {
    key: 'FREE',
    name: 'Starter',
    eyebrow: 'Go live',
    usd: 0,
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
    catalogKey: 'BUILDER',
    usd: 35,
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
    catalogKey: 'PRO',
    usd: 143,
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
    catalogKey: 'TIER4',
    usd: 350,
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
    q: 'Why are prices shown in dollars but paid in Pi?',
    a: "Each plan is pegged to a fixed US-dollar value for stability, and charged in Pi at the live exchange rate when you pay. As Pi's value rises, the same plan costs fewer Pi.",
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

type PricingState = 'loading' | 'ready' | 'unavailable';

export default function Pricing() {
  const { user, isAuthenticated, refreshUser, signOut } = useAuth();
  const { success, error: toastError } = useToast();
  const [subData, setSubData] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [payingTier, setPayingTier] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  // Live Pi peg — fetched non-blocking from the PUBLIC pricing endpoint. The
  // dollar anchors render instantly from local config; the Pi headline fills in
  // when this resolves, and falls back to a short "updating" label (never an
  // infinite spinner) if the live rate is briefly unavailable.
  const [livePi, setLivePi] = useState<Record<string, number> | null>(null);
  const [pricingState, setPricingState] = useState<PricingState>('loading');

  useEffect(() => {
    let active = true;
    billingApi
      .pricing()
      .then((res) => {
        if (!active) return;
        const map: Record<string, number> = {};
        for (const p of res.data.plans) map[p.key] = p.quotedPiAmount;
        setLivePi(map);
        setPricingState('ready');
      })
      .catch(() => {
        if (active) setPricingState('unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

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

  const handleUpgrade = async (
    tierKey: string,
    catalogKey: string,
    tierLabel: string,
    months: number,
  ) => {
    if (!window.Pi) {
      toastError('Open this app in Pi Browser to pay with Pi.');
      return;
    }
    setPayingTier(tierKey);
    const env = getEnv();

    // Fetch a FRESH server quote at tap time — this is the price actually
    // charged, and the server validates the payment against it. If a live Pi
    // price can't be obtained we bail cleanly with a retry hint, never a hang.
    let quoteId: string;
    let quotedPi: number;
    try {
      const res = await billingApi.quote(catalogKey, env);
      quoteId = res.data.quote.id;
      quotedPi = Number(res.data.quote.quotedPiAmount); // Prisma Decimal → string
      if (!Number.isFinite(quotedPi) || quotedPi <= 0) {
        throw new Error('Invalid quote amount');
      }
    } catch {
      toastError('Pi pricing is briefly unavailable — please try again.');
      setPayingTier(null);
      return;
    }

    const multiplier = months === 12 ? ANNUAL_MULTIPLIER : 1;
    const amount = Math.round(quotedPi * multiplier * 1e7) / 1e7;
    const periodLabel = months === 12 ? '1 year' : '1 month';

    // The Pi SDK handshake below is intentionally identical to the legacy flow —
    // only the amount (a live quote) and the metadata (a quoteId locating the
    // server quote) change.
    window.Pi.createPayment(
      {
        amount,
        memo: `Cherri Hosting ${tierLabel} — ${periodLabel}`,
        metadata: { quoteId, catalogKey, plan: catalogKey, tier: tierKey, months, env },
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

      <PageHeader
        title={isAuthenticated ? 'Plans' : 'Simple, Pi-powered pricing'}
        subtitle="Pay with Pi. No credit cards. Cancel anytime."
      />

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
        {/* One-line peg note — the whole pricing model in a sentence. */}
        <p className="text-center text-xs text-ink-mut max-w-sm mx-auto">
          Prices are pegged to a US-dollar value and paid in Pi at the live rate — as Pi
          rises, the same plan costs fewer&nbsp;π.
        </p>
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
              livePi={livePi}
              pricingState={pricingState}
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
      <main className="max-w-screen-sm mx-auto px-5 pt-7 pb-14 space-y-7 animate-fade-in">
        {body}
      </main>
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface TierCardContentProps {
  tier: TierDef;
  billingPeriod: 'monthly' | 'annual';
  livePi: Record<string, number> | null;
  pricingState: PricingState;
  isCurrentTier: boolean;
  isPaidAndActive: boolean;
  isAuthenticated: boolean;
  canUpgrade: boolean;
  payingTier: string | null;
  onUpgrade: (key: string, catalogKey: string, label: string, months: number) => void;
}

function TierCardContent({
  tier,
  billingPeriod,
  livePi,
  pricingState,
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

  const isAnnual = billingPeriod === 'annual';
  const isPaid = tier.usd > 0;
  const multiplier = isAnnual ? ANNUAL_MULTIPLIER : 1;
  const months = isAnnual ? 12 : 1;
  const periodSuffix = isAnnual ? '/yr' : '/mo';

  // Live Pi peg for this plan (monthly), if the public rate has resolved.
  const monthlyPi = tier.catalogKey ? livePi?.[tier.catalogKey] : undefined;
  const piReady = pricingState === 'ready' && typeof monthlyPi === 'number';
  const piHeadline = piReady ? Math.round((monthlyPi as number) * multiplier) : null;
  const usdForPeriod = tier.usd * multiplier;

  return (
    <>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mut">
          {tier.eyebrow}
        </p>
        <h2 className="text-lg font-bold text-ink font-display mt-0.5">{tier.name}</h2>

        {/* Price block — Pi is the headline, the dollar value is the peg beneath. */}
        <div className="mt-2">
          {!isPaid ? (
            <span className="text-4xl font-bold text-ink font-display tracking-tight">Free</span>
          ) : piHeadline !== null ? (
            <div className="flex items-baseline gap-1">
              <span className="text-ink-mut text-xl font-semibold">≈</span>
              <span className="text-4xl font-bold text-ink font-display tracking-tight">
                {piHeadline.toLocaleString()}
              </span>
              <span className="text-xl font-mono text-ink">π</span>
              <span className="text-ink-mut text-sm ml-0.5">{periodSuffix}</span>
            </div>
          ) : (
            <span className="text-2xl font-semibold text-ink-mut font-display">
              {pricingState === 'loading' ? '≈ updating…' : '≈ Pi price updating'}
            </span>
          )}

          {isPaid && (
            <p className="text-ink-mut text-xs mt-1">
              pegged to ${usdForPeriod.toLocaleString()} · paid in Pi
            </p>
          )}
          {isPaid && isAnnual && piReady && (
            <p className="text-ink-mut text-xs mt-0.5">
              ≈ <span className="font-mono">{Math.round(monthlyPi as number).toLocaleString()} π</span>/mo
              billed yearly
            </p>
          )}
        </div>

        <p className="text-ink-mut text-sm mt-2 leading-snug">{tier.headline}</p>
      </div>

      <ul className="space-y-2.5 flex-1">
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
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-800/60 px-3.5 py-2.5">
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
        ) : canUpgrade && tier.catalogKey ? (
          <Button
            variant={tier.popular ? 'primary' : 'secondary'}
            className="w-full justify-center"
            onClick={() => onUpgrade(tier.key, tier.catalogKey!, tier.name, months)}
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
            {!isPaid ? tier.cta : 'Sign in to upgrade'}
          </Button>
        </Link>
      )}
    </>
  );
}
