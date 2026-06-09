import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { subscriptionsApi } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { Subscription } from '../types';
import {
  TIER1_PRICE_PI,
  TIER2_PRICE_PI,
  TIER3_PRICE_PI,
  TIER4_PRICE_PI,
  TIER_LABELS,
  TIER_STORAGE_LABELS,
} from '../lib/constants';

interface SubscriptionData {
  subscription: Subscription | null;
  user: { tier: string; storageUsed: number; storageLimit: number } | null;
}

interface TierDef {
  key: string;
  label: string;
  price: number;
  storage: string;
  uploadLimit: string;
  domains: string;
  features: string[];
  popular?: boolean;
}

const TIERS: TierDef[] = [
  {
    key: 'FREE',
    label: 'Free',
    price: 0,
    storage: '500 MB',
    uploadLimit: '50 MB / upload',
    domains: '1 Pi domain',
    features: [
      'Unlimited deployments',
      'IPFS gateway URLs',
      'Pi authentication',
      'Community support',
    ],
  },
  {
    key: 'TIER1',
    label: 'Tier 1',
    price: TIER1_PRICE_PI,
    storage: '2 GB',
    uploadLimit: '200 MB / upload',
    domains: '1 Pi domain',
    features: [
      'All Free features',
      'Priority IPFS pinning',
      'Email support',
    ],
  },
  {
    key: 'TIER2',
    label: 'Tier 2',
    price: TIER2_PRICE_PI,
    storage: '10 GB',
    uploadLimit: '1 GB / upload',
    domains: '5 Pi domains',
    features: [
      'All Tier 1 features',
      'Multi-domain mapping',
      'Priority support',
    ],
    popular: true,
  },
  {
    key: 'TIER3',
    label: 'Tier 3',
    price: TIER3_PRICE_PI,
    storage: '50 GB',
    uploadLimit: '2 GB / upload',
    domains: 'Unlimited domains',
    features: [
      'All Tier 2 features',
      'Bulk deployments',
      'Dedicated pinning',
    ],
  },
  {
    key: 'TIER4',
    label: 'Tier 4',
    price: TIER4_PRICE_PI,
    storage: '100 GB',
    uploadLimit: '2 GB / upload',
    domains: 'Unlimited domains',
    features: [
      'All Tier 3 features',
      'Dedicated support',
      'SLA guarantee',
    ],
  },
];

export default function Pricing() {
  const { user, isAuthenticated, refreshUser } = useAuth();
  const [subData, setSubData] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [payingTier, setPayingTier] = useState<string | null>(null);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    subscriptionsApi
      .current()
      .then((res) => setSubData(res.data as SubscriptionData))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

  const currentTier = subData?.user?.tier ?? user?.tier ?? 'FREE';

  const handleUpgrade = (tierKey: string, amount: number, tierLabel: string) => {
    if (!window.Pi) {
      setPayError('Pi SDK not available. Please open this app in Pi Browser.');
      return;
    }
    setPayingTier(tierKey);
    setPayError('');
    setPaySuccess('');

    window.Pi.createPayment(
      {
        amount,
        memo: `Sherry Hosting ${tierLabel} — 1 month`,
        metadata: { plan: tierKey.toLowerCase(), tier: tierKey, months: 1 },
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          try {
            await subscriptionsApi.approvePayment(paymentId);
          } catch {
            setPayError('Failed to approve payment. Please try again.');
            setPayingTier(null);
          }
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          try {
            await subscriptionsApi.completePayment(paymentId, txid, amount);
            setPaySuccess(`You're now on ${tierLabel}!`);
            const res = await subscriptionsApi.current();
            setSubData(res.data as SubscriptionData);
            await refreshUser?.();
          } catch {
            setPayError('Payment recorded but activation failed. Please contact support.');
          } finally {
            setPayingTier(null);
          }
        },
        onCancel: () => setPayingTier(null),
        onError: (err) => {
          setPayError(err.message ?? 'Payment failed');
          setPayingTier(null);
        },
      },
    );
  };

  return (
    <div className={isAuthenticated ? 'flex h-screen overflow-hidden bg-surface-950' : 'min-h-screen bg-surface-950'}>
      {isAuthenticated && <Sidebar />}

      <main className={`${isAuthenticated ? 'flex-1 overflow-y-auto' : ''}`}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
          {!isAuthenticated && (
            <div className="flex items-center gap-2 mb-8">
              <Link to="/" className="flex items-center gap-2">
                <span className="text-2xl">🌐</span>
                <span className="font-bold text-white text-xl">Sherry Hosting</span>
              </Link>
            </div>
          )}

          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-3">Simple, Pi-powered pricing</h1>
            <p className="text-surface-400">Pay with Pi. No credit cards. Cancel anytime.</p>
          </div>

          {isAuthenticated && isLoading && (
            <div className="flex justify-center"><Spinner /></div>
          )}

          {paySuccess && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm text-center">
              🎉 {paySuccess}
            </div>
          )}
          {payError && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {payError}
            </div>
          )}

          {/* Tier cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {TIERS.map((tier) => {
              const isCurrentTier = currentTier === tier.key;
              const isPaidAndActive = isCurrentTier && tier.key !== 'FREE';

              if (tier.popular) {
                return (
                  <div key={tier.key} className="bg-cherry-gradient p-px rounded-xl sm:col-span-2 lg:col-span-1">
                    <div className="bg-surface-900 rounded-[11px] p-5 flex flex-col gap-4 h-full">
                      <TierCardContent
                        tier={tier}
                        isCurrentTier={isCurrentTier}
                        isPaidAndActive={isPaidAndActive}
                        isAuthenticated={isAuthenticated}
                        payingTier={payingTier}
                        onUpgrade={handleUpgrade}
                        badgeExtra={<Badge variant="premium">POPULAR</Badge>}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <Card key={tier.key} className={`flex flex-col gap-4 ${isCurrentTier ? 'border-cherry-500/40' : ''}`}>
                  <TierCardContent
                    tier={tier}
                    isCurrentTier={isCurrentTier}
                    isPaidAndActive={isPaidAndActive}
                    isAuthenticated={isAuthenticated}
                    payingTier={payingTier}
                    onUpgrade={handleUpgrade}
                  />
                </Card>
              );
            })}
          </div>

          {/* Current plan banner */}
          {isAuthenticated && !isLoading && currentTier !== 'FREE' && (
            <Card className="border-cherry-500/30 text-center py-5">
              <p className="text-2xl mb-1">🎉</p>
              <p className="text-white font-semibold">
                You're on {TIER_LABELS[currentTier] ?? currentTier}
                {' '}({TIER_STORAGE_LABELS[currentTier] ?? ''} storage)
              </p>
              {subData?.subscription && (
                <p className="text-surface-400 text-sm mt-1">
                  Active until{' '}
                  {new Date(subData.subscription.periodEnd).toLocaleDateString()}
                </p>
              )}
            </Card>
          )}

          {/* FAQ */}
          <div className="space-y-4 pt-4">
            <h2 className="text-xl font-bold text-white">FAQ</h2>
            {[
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
                a: 'Yes. Domains are acquired through Pi Network\'s official domain auction — Sherry does not sell domains. Once you own a Pi domain, any paid tier lets you map it to your deployment from the dashboard.',
              },
              {
                q: 'What if I exceed my storage?',
                a: 'New deployments are paused until you upgrade or free up space. Your existing deployments remain live on IPFS.',
              },
              {
                q: 'Can I upload entire project folders?',
                a: 'Yes. The deploy panel accepts full folder drag-and-drop or a ZIP archive. The full directory structure is preserved on IPFS.',
              },
            ].map(({ q, a }) => (
              <Card key={q}>
                <p className="font-medium text-white mb-1">{q}</p>
                <p className="text-surface-400 text-sm">{a}</p>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface TierCardContentProps {
  tier: TierDef;
  isCurrentTier: boolean;
  isPaidAndActive: boolean;
  isAuthenticated: boolean;
  payingTier: string | null;
  onUpgrade: (key: string, amount: number, label: string) => void;
  badgeExtra?: React.ReactNode;
}

function TierCardContent({
  tier,
  isCurrentTier,
  isPaidAndActive,
  isAuthenticated,
  payingTier,
  onUpgrade,
  badgeExtra,
}: TierCardContentProps) {
  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-bold text-white">{tier.label}</h2>
          {badgeExtra}
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-3xl font-bold text-white">{tier.price}</span>
          <span className="text-surface-400 text-sm">
            {tier.price === 0 ? 'Pi — free forever' : 'Pi / month'}
          </span>
        </div>
      </div>

      <div className="space-y-1 text-xs text-surface-400">
        <div className="flex gap-2">
          <span className="text-surface-500">Storage</span>
          <span className="text-surface-200 ml-auto">{tier.storage}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-surface-500">Upload</span>
          <span className="text-surface-200 ml-auto">{tier.uploadLimit}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-surface-500">Domains</span>
          <span className="text-surface-200 ml-auto">{tier.domains}</span>
        </div>
      </div>

      <ul className="space-y-2 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-surface-300">
            <span className="text-cherry-400">✓</span> {f}
          </li>
        ))}
      </ul>

      {isAuthenticated ? (
        isCurrentTier ? (
          <Badge variant={tier.key === 'FREE' ? 'default' : 'success'} className="self-start">
            {isPaidAndActive ? 'Active plan' : 'Current plan'}
          </Badge>
        ) : tier.price === 0 ? null : (
          <Button
            className="w-full justify-center"
            onClick={() => onUpgrade(tier.key, tier.price, tier.label)}
            isLoading={payingTier === tier.key}
            disabled={payingTier !== null && payingTier !== tier.key}
          >
            Get {tier.label} with Pi
          </Button>
        )
      ) : (
        <Link to="/">
          <Button
            variant={tier.price === 0 ? 'secondary' : 'primary'}
            className="w-full justify-center"
          >
            {tier.price === 0 ? 'Sign in with Pi' : 'Sign in to upgrade'}
          </Button>
        </Link>
      )}
    </>
  );
}
