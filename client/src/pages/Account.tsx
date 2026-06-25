import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import TierBadge from '../components/ui/TierBadge';
import StorageBar from '../components/dashboard/StorageBar';
import Skeleton from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../providers/AuthProvider';
import { authApi, subscriptionsApi, extractApiError } from '../lib/api';
import { formatBytes } from '../lib/format';

interface UserProfile {
  id: string;
  piUserId: string;
  username: string;
  email: string | null;
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
  const { user, refreshUser } = useAuth();
  const { success, error: toastError } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subData, setSubData] = useState<SubData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [editingEmail, setEditingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    Promise.all([authApi.me(), subscriptionsApi.current()])
      .then(([meRes, subRes]) => {
        const p = (meRes.data as { user: UserProfile }).user;
        setProfile(p);
        setEmailValue(p.email ?? '');
        setSubData(subRes.data as SubData);
      })
      .catch((err) => {
        toastError(extractApiError(err, 'Could not load your account. Please refresh.'));
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    try {
      await authApi.updateProfile({ email: emailValue.trim() || undefined });
      const meRes = await authApi.me();
      const p = (meRes.data as { user: UserProfile }).user;
      setProfile(p);
      setEmailValue(p.email ?? '');
      await refreshUser();
      setEditingEmail(false);
      success('Email updated');
    } catch (err) {
      toastError(extractApiError(err, 'Could not update email. Try again.'));
    } finally {
      setSavingEmail(false);
    }
  };

  const tier = subData?.user?.tier ?? user?.tier ?? 'FREE';
  const storageUsed = subData?.user?.storageUsed ?? user?.storageUsed ?? 0;
  const storageLimit = subData?.user?.storageLimit ?? user?.storageLimit ?? 0;
  const projectCount = profile?._count?.projects ?? 0;

  return (
    <AppShell>
      <div>
        <h1 className="text-xl font-bold text-ink font-display tracking-tight">Account</h1>
        <p className="text-ink-mut text-sm mt-0.5">Your plan, usage, and profile.</p>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Current plan</h2>
          {isLoading ? <Skeleton className="h-5 w-16" /> : <TierBadge tier={tier} />}
        </div>
        {isLoading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <>
            {subData?.subscription && (
              <p className="text-xs text-ink-mut mb-3">
                Status: <span className="text-ink">{subData.subscription.status}</span>
                {subData.subscription.currentPeriodEnd && (
                  <> · Renews {new Date(subData.subscription.currentPeriodEnd).toLocaleDateString()}</>
                )}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              {tier === 'FREE' && (
                <Link to="/pricing">
                  <Button size="sm">Upgrade plan</Button>
                </Link>
              )}
              <Link to="/billing">
                <Button size="sm" variant="secondary">Billing history</Button>
              </Link>
            </div>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Usage</h2>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-ink-mut">Storage</span>
                <span className="font-mono text-ink">
                  {formatBytes(storageUsed)}{' '}
                  <span className="text-ink-mut">/ {formatBytes(storageLimit)}</span>
                </span>
              </div>
              <StorageBar used={storageUsed} limit={storageLimit} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-mut">Projects</span>
              <span className="font-mono text-ink">{projectCount}</span>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Profile</h2>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-mut">Username</span>
              <span className="font-mono text-ink">{profile?.username ?? user?.username ?? '—'}</span>
            </div>

            <div className="flex items-start justify-between gap-3">
              <span className="text-ink-mut shrink-0 pt-0.5">Email</span>
              {editingEmail ? (
                <div className="flex-1 flex flex-col gap-2">
                  <input
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    className="w-full bg-surface-800 border border-hairline rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-gold transition-colors"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      isLoading={savingEmail}
                      onClick={() => void handleSaveEmail()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingEmail(false);
                        setEmailValue(profile?.email ?? '');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-ink truncate">
                    {profile?.email ?? '—'}
                  </span>
                  <button
                    className="shrink-0 text-xs text-ink-mut hover:text-ink underline transition-colors"
                    onClick={() => setEditingEmail(true)}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
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

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3">Pi Network</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-mut">Pi user ID</span>
          <span className="font-mono text-xs text-ink truncate max-w-[160px]">
            {profile?.piUserId ?? user?.piUserId ?? '—'}
          </span>
        </div>
      </Card>
    </AppShell>
  );
}
