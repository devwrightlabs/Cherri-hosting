import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import TierBadge from '../components/ui/TierBadge';
import StorageBar from '../components/dashboard/StorageBar';
import Skeleton from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../providers/AuthProvider';
import { subscriptionStatusLabel } from '../lib/statusLabels';
import { authApi, subscriptionsApi, extractApiError } from '../lib/api';

interface UserProfile {
  id: string;
  piUserId: string;
  username: string;
  tier: string;
  storageUsed: number;
  storageLimit: number;
  createdAt: string;
  _count?: { projects: number };
}

interface SubData {
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  user: { tier: string; storageUsed: number; storageLimit: number } | null;
}

export default function Account() {
  const { user } = useAuth();
  const { error: toastError } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subData, setSubData] = useState<SubData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([authApi.me(), subscriptionsApi.current()])
      .then(([meRes, subRes]) => {
        const p = (meRes.data as { user: UserProfile }).user;
        setProfile(p);
        setSubData(subRes.data as SubData);
      })
      .catch((err) => {
        toastError(extractApiError(err, 'Could not load your account. Please refresh.'));
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tier = subData?.user?.tier ?? user?.tier ?? 'FREE';
  const storageUsed = subData?.user?.storageUsed ?? user?.storageUsed ?? 0;
  const storageLimit = subData?.user?.storageLimit ?? user?.storageLimit ?? 0;
  const projectCount = profile?._count?.projects ?? 0;

  return (
    <AppShell>
      <PageHeader title="Account" subtitle="Your plan, usage, and profile." className="animate-fade-in" />

      {/* Prominent plan + usage card */}
      <Card className="animate-fade-in" style={{ animationDelay: '50ms' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-mut mb-1.5">
              Current plan
            </p>
            {isLoading ? <Skeleton className="h-6 w-20" /> : <TierBadge tier={tier} />}
          </div>
          {!isLoading && (
            <div className="flex gap-2">
              {tier === 'FREE' && (
                <Link to="/pricing">
                  <Button size="sm">Upgrade</Button>
                </Link>
              )}
              <Link to="/billing">
                <Button size="sm" variant="secondary">Billing</Button>
              </Link>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : (
          <div className="space-y-5">
            {subData?.subscription && (
              <p className="text-xs text-ink-mut">
                Status: <span className="text-ink">{subscriptionStatusLabel(subData.subscription.status)}</span>
                {subData.subscription.currentPeriodEnd && (
                  <> · Renews {new Date(subData.subscription.currentPeriodEnd).toLocaleDateString()}</>
                )}
              </p>
            )}
            <StorageBar used={storageUsed} limit={storageLimit} />
            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-ink-mut">Projects</span>
              <span className="font-mono text-ink">{projectCount}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Profile */}
      <Card className="animate-fade-in" style={{ animationDelay: '100ms' }}>
        <h2 className="text-xl font-bold text-ink font-display tracking-tight mb-5">Profile</h2>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            <div className="flex items-center justify-between py-3 first:pt-0 text-sm">
              <span className="text-ink-mut">Username</span>
              <span className="font-mono text-ink">{profile?.username ?? user?.username ?? '—'}</span>
            </div>

            <div className="flex items-center justify-between py-3 last:pb-0 text-sm">
              <span className="text-ink-mut">Member since</span>
              <span className="text-ink">
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString()
                  : '—'}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Pi Network */}
      <Card className="animate-fade-in" style={{ animationDelay: '150ms' }}>
        <h2 className="text-xl font-bold text-ink font-display tracking-tight mb-5">Pi Network</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-mut">Pi user ID</span>
          <span className="font-mono text-xs text-ink bg-surface-800 px-2 py-1 rounded border border-hairline truncate max-w-[160px]">
            {profile?.piUserId ?? user?.piUserId ?? '—'}
          </span>
        </div>
      </Card>

      {/* Support — the only way to reach us (Pi-only app: no email). */}
      <Card className="animate-fade-in" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink font-display tracking-tight">Support</h2>
            <p className="text-xs text-ink-mut mt-1">Have a problem? Open a ticket — we reply here in the app.</p>
          </div>
          <Link to="/support">
            <Button size="sm" variant="secondary">Open</Button>
          </Link>
        </div>
      </Card>
    </AppShell>
  );
}
