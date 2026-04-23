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

const PREMIUM_AMOUNT = 10;

interface SubscriptionData {
  subscription: Subscription | null;
  user: { tier: string; storageUsed: number; storageLimit: number } | null;
}

export default function Pricing() {
  const { user, isAuthenticated } = useAuth();
  const [subData, setSubData] = useState<SubscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    subscriptionsApi
      .current()
      .then((res) => setSubData(res.data as SubscriptionData))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [isAuthenticated]);

  const handleUpgrade = async () => {
    if (!window.Pi) {
      setPayError('Pi SDK not available. Please open this app in Pi Browser.');
      return;
    }
    setIsPaying(true);
    setPayError('');

    window.Pi.createPayment(
      {
        amount: PREMIUM_AMOUNT,
        memo: 'Cherri Hosting Premium — 1 month',
        metadata: { plan: 'premium', months: 1 },
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          try {
            await subscriptionsApi.approvePayment(paymentId);
          } catch {
            setPayError('Failed to approve payment. Please try again.');
            setIsPaying(false);
          }
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          try {
            await subscriptionsApi.completePayment(paymentId, txid);
            setPaySuccess(true);
            // Reload subscription data
            const res = await subscriptionsApi.current();
            setSubData(res.data as SubscriptionData);
          } catch {
            setPayError('Payment recorded but activation failed. Please contact support.');
          } finally {
            setIsPaying(false);
          }
        },
        onCancel: () => {
          setIsPaying(false);
        },
        onError: (err) => {
          setPayError(err.message ?? 'Payment failed');
          setIsPaying(false);
        },
      },
    );
  };

  const isPremium = user?.tier === 'PREMIUM' || subData?.user?.tier === 'PREMIUM';

  return (
    <div className={isAuthenticated ? 'flex h-screen overflow-hidden bg-surface-950' : 'min-h-screen bg-surface-950'}>
      {isAuthenticated && <Sidebar />}

      <main className={`${isAuthenticated ? 'flex-1 overflow-y-auto' : ''}`}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
          {!isAuthenticated && (
            <div className="flex items-center gap-2 mb-8">
              <Link to="/" className="flex items-center gap-2">
                <span className="text-2xl">🍒</span>
                <span className="font-bold text-white text-xl">Cherri Hosting</span>
              </Link>
            </div>
          )}

          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-3">Simple, Pi-powered pricing</h1>
            <p className="text-surface-400">Pay with Pi. No credit cards. Cancel anytime.</p>
          </div>

          {/* Current plan */}
          {isAuthenticated && isLoading && (
            <div className="flex justify-center">
              <Spinner />
            </div>
          )}

          {isAuthenticated && !isLoading && isPremium && (
            <Card className="border-cherry-500/30 text-center py-6">
              <p className="text-2xl mb-2">🎉</p>
              <p className="text-white font-semibold">You're on Premium</p>
              {subData?.subscription && (
                <p className="text-surface-400 text-sm mt-1">
                  Active until{' '}
                  {new Date(subData.subscription.periodEnd).toLocaleDateString()}
                </p>
              )}
              <Badge variant="premium" className="mt-3">PREMIUM</Badge>
            </Card>
          )}

          {paySuccess && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm text-center">
              🎉 Payment confirmed! You're now on Premium.
            </div>
          )}

          {payError && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {payError}
            </div>
          )}

          {/* Tier cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Free */}
            <Card className="flex flex-col gap-5">
              <div>
                <h2 className="text-xl font-bold text-white">Free</h2>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-4xl font-bold text-white">0</span>
                  <span className="text-surface-400">Pi / month</span>
                </div>
              </div>
              <ul className="space-y-3 flex-1">
                {[
                  '500 MB storage',
                  'Unlimited deployments',
                  'IPFS gateway URLs',
                  'Pi authentication',
                  'Community support',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-surface-300">
                    <span className="text-cherry-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              {isAuthenticated ? (
                <Badge variant="default" className="self-start">Current plan</Badge>
              ) : (
                <Link to="/">
                  <Button variant="secondary" className="w-full justify-center">
                    Get started free
                  </Button>
                </Link>
              )}
            </Card>

            {/* Premium — gradient border */}
            <div className="bg-cherry-gradient p-px rounded-xl">
              <div className="bg-surface-900 rounded-[11px] p-5 flex flex-col gap-5 h-full">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-white">Premium</h2>
                    <Badge variant="premium">POPULAR</Badge>
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl font-bold text-white">{PREMIUM_AMOUNT}</span>
                    <span className="text-surface-400">Pi / month</span>
                  </div>
                </div>
                <ul className="space-y-3 flex-1">
                  {[
                    '10 GB storage',
                    'Unlimited deployments',
                    'Custom domain support',
                    'Priority IPFS pinning',
                    'Priority support',
                    'All Free features',
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-surface-300">
                      <span className="text-cherry-400">✓</span> {f}
                    </li>
                  ))}
                </ul>
                {isAuthenticated ? (
                  isPremium ? (
                    <Badge variant="success" className="self-start">Active</Badge>
                  ) : (
                    <Button
                      className="w-full justify-center"
                      onClick={handleUpgrade}
                      isLoading={isPaying}
                    >
                      🍒 Upgrade with Pi
                    </Button>
                  )
                ) : (
                  <Link to="/">
                    <Button className="w-full justify-center">Sign in to upgrade</Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

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
                a: 'Custom domains are available on the Premium plan. Point your domain\'s CNAME to our gateway and we handle the rest.',
              },
              {
                q: 'What happens if I exceed my storage?',
                a: 'New deployments will be paused. Upgrade to Premium to increase your limit to 10 GB.',
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
