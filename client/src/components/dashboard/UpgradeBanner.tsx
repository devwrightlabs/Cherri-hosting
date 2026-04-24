import { useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { subscriptionsApi } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';

const PREMIUM_AMOUNT = 10;

interface UpgradeBannerProps {
  /** Called when payment succeeds so parent can refresh user data */
  onUpgradeSuccess?: () => void;
}

export default function UpgradeBanner({ onUpgradeSuccess }: UpgradeBannerProps) {
  const { user } = useAuth();
  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState(false);

  const isPremium = user?.tier === 'PREMIUM';

  const handleUpgrade = () => {
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
            onUpgradeSuccess?.();
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

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Subscription</h2>
        <Badge variant={isPremium ? 'premium' : 'default'}>
          {user?.tier ?? 'FREE'}
        </Badge>
      </div>

      {paySuccess && (
        <div className="mb-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-400">
          🎉 You&apos;re now on Premium!
        </div>
      )}

      {payError && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          {payError}
        </div>
      )}

      <div className="space-y-2 text-sm">
        {isPremium ? (
          <>
            <div className="flex items-center gap-2 text-emerald-400">
              <span>✓</span>
              <span>10 GB storage</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <span>✓</span>
              <span>Priority IPFS pinning</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <span>✓</span>
              <span>Custom domains</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <span>✓</span>
              <span>Unlimited deployments</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-surface-400">
              <span>✓</span>
              <span>500 MB storage</span>
            </div>
            <div className="flex items-center gap-2 text-surface-400">
              <span>✓</span>
              <span>IPFS hosting</span>
            </div>
            <div className="flex items-center gap-2 text-surface-600">
              <span>✗</span>
              <span>Custom domains</span>
            </div>
            <div className="flex items-center gap-2 text-surface-600">
              <span>✗</span>
              <span>Priority pinning</span>
            </div>
            <Button
              size="sm"
              className="w-full justify-center mt-3"
              onClick={handleUpgrade}
              isLoading={isPaying}
            >
              🍒 Upgrade with Pi ({PREMIUM_AMOUNT} Pi/mo)
            </Button>
            <Link to="/pricing" className="block">
              <p className="text-xs text-center text-surface-500 hover:text-cherry-400 transition-colors">
                View full pricing details →
              </p>
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
