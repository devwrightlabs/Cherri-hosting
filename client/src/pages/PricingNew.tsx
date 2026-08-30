/**
 * Redesigned Pricing Page
 * 
 * Features:
 * - USD pricing display with Pi payment conversion
 * - Cyan/Teal theme matching
 * - Bento-style tier cards
 * - Clear Free vs Paid differentiation
 * - Shimmer buttons
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import LogoMark from '../components/ui/LogoMark';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../providers/AuthProvider';
import EnvironmentToggle from '../components/EnvironmentToggle';

interface TierDef {
  key: string;
  name: string;
  eyebrow: string;
  usd: number; // USD price
  piAmount: number; // Pi conversion
  headline: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

const TIERS: TierDef[] = [
  {
    key: 'FREE',
    name: 'Starter',
    eyebrow: 'Go live free',
    usd: 0,
    piAmount: 0,
    headline: 'Deploy static sites to IPFS. Permanent, decentralized, no cost.',
    features: [
      '1 project',
      'IPFS hosting only',
      '500 MB storage',
      'Free .pie subdomain',
      'Community support',
    ],
    cta: 'Get started free',
  },
  {
    key: 'TIER1',
    name: 'Builder',
    eyebrow: 'Power up',
    usd: 35,
    piAmount: 150,
    headline: 'Add custom backend, database, and your own Pi domain.',
    features: [
      '3 projects',
      'Node.js/Python/Go backend',
      'SQLite + PostgreSQL',
      '2 GB storage',
      '1 custom Pi domain',
      'Priority support',
    ],
    cta: 'Start building',
  },
  {
    key: 'TIER2',
    name: 'Pro',
    eyebrow: 'Ship faster',
    usd: 143,
    piAmount: 600,
    headline: 'Unlimited projects, 5 domains, advanced analytics.',
    features: [
      'Unlimited projects',
      'Advanced backends',
      'PostgreSQL focus',
      '10 GB storage',
      '5 Pi domains',
      'Analytics dashboard',
    ],
    cta: 'Go pro',
    highlighted: true,
  },
  {
    key: 'TIER3',
    name: 'Business',
    eyebrow: 'Enterprise ready',
    usd: 350,
    piAmount: 1500,
    headline: 'Team collaboration, API access, featured marketplace spot.',
    features: [
      'Unlimited everything',
      'Team + RBAC',
      'API & CLI access',
      '50 GB storage',
      'Unlimited domains',
      'Featured marketplace',
    ],
    cta: 'Scale up',
  },
];

export default function PricingNew() {
  const { isAuthenticated } = useAuth();
  const { success, error: toastError } = useToast();
  const [environment, setEnvironment] = useState<'Live' | 'Test'>('Live');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0 },
  };

  const handleSelectTier = (tierKey: string) => {
    setSelectedTier(tierKey);
    if (tierKey === 'FREE') {
      success('Ready to deploy! Sign in to get started.');
    } else if (isAuthenticated) {
      // Proceed to payment
      success(`Upgrading to ${tierKey}...`);
    } else {
      toastError('Sign in first to upgrade');
    }
  };

  const body = (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Environment and Billing controls */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EnvironmentToggle
          environment={environment}
          onChange={setEnvironment}
        />

        {/* Billing period toggle */}
        <Card>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-mut">Billing</p>
            <div className="flex gap-2">
              {(['monthly', 'annual'] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setBillingPeriod(period)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                    billingPeriod === period
                      ? 'bg-primary text-surface-950'
                      : 'bg-surface-800 text-ink hover:bg-surface-700'
                  }`}
                >
                  {period === 'monthly' ? 'Monthly' : 'Annual'}
                </button>
              ))}
            </div>
            {billingPeriod === 'annual' && (
              <p className="text-xs text-live font-semibold">2 months free</p>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Pricing pitch */}
      <motion.div variants={itemVariants}>
        <PageHeader
          title="Simple, transparent pricing"
          subtitle="Pay in Pi. No credit cards, no hidden fees. Cancel anytime."
        />
      </motion.div>

      {/* Tier cards - bento layout */}
      <motion.div
        variants={containerVariants}
        className="space-y-4"
      >
        {TIERS.map((tier) => {
          const isSelected = selectedTier === tier.key;
          const multiplier = billingPeriod === 'annual' ? 10 : 1; // Save 2 months

          return (
            <motion.div
              key={tier.key}
              variants={itemVariants}
              className={`relative ${tier.highlighted ? 'md:scale-105 md:z-10' : ''}`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-surface-950 font-bold">
                    Most Popular
                  </Badge>
                </div>
              )}

              <Card
                className={`p-5 space-y-4 transition-all ${
                  tier.highlighted
                    ? 'border-primary/50 bg-gradient-to-br from-primary/10 to-secondary/5'
                    : isSelected
                      ? 'border-primary/30'
                      : ''
                }`}
              >
                {/* Header */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mut">
                    {tier.eyebrow}
                  </p>
                  <h2 className="text-2xl font-bold text-ink font-display mt-1">
                    {tier.name}
                  </h2>

                  {/* Price */}
                  <div className="mt-3 space-y-1">
                    {tier.usd === 0 ? (
                      <span className="text-4xl font-bold text-primary font-display">Free</span>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm text-ink-mut">≈</span>
                          <span className="text-4xl font-bold text-primary font-display">
                            {Math.round(tier.piAmount * multiplier)}
                          </span>
                          <span className="text-lg text-ink font-mono">π</span>
                          {billingPeriod === 'annual' && (
                            <span className="text-sm text-ink-mut ml-1">/yr</span>
                          )}
                        </div>
                        <p className="text-xs text-ink-mut">
                          pegged to ${tier.usd * multiplier}/
                          {billingPeriod === 'monthly' ? 'mo' : 'yr'} · paid in Pi
                        </p>
                      </>
                    )}
                  </div>

                  <p className="text-sm text-ink-mut mt-3 leading-relaxed">{tier.headline}</p>
                </div>

                {/* Features */}
                <ul className="space-y-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        className="text-primary mt-0.5 shrink-0"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span className="text-ink">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  variant={tier.highlighted ? 'primary' : 'secondary'}
                  className="w-full justify-center"
                  onClick={() => handleSelectTier(tier.key)}
                  isLoading={selectedTier === tier.key}
                >
                  {tier.cta}
                </Button>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* FAQ */}
      <motion.div variants={itemVariants} className="space-y-3">
        <h2 className="text-lg font-bold text-ink font-display">Frequently Asked</h2>

        {[
          {
            q: 'Why is pricing in USD but payments in Pi?',
            a: 'USD provides stable pricing parity. You always pay at the live Pi/USD rate, so the same tier costs fewer Pi as Pi appreciates.',
          },
          {
            q: 'Can I upgrade or downgrade anytime?',
            a: 'Yes. Changes take effect immediately. Downgrades are prorated; upgrades charge the difference.',
          },
          {
            q: 'What databases does Paid tier include?',
            a: 'SQLite (embedded) for quick prototypes, or PostgreSQL for production. Scale as you grow.',
          },
          {
            q: 'Do you offer team/enterprise plans?',
            a: 'Business tier includes team collaboration. For advanced needs, contact us.',
          },
        ].map(({ q, a }) => (
          <Card key={q} className="p-3">
            <p className="font-semibold text-ink text-sm mb-1">{q}</p>
            <p className="text-xs text-ink-mut leading-relaxed">{a}</p>
          </Card>
        ))}
      </motion.div>
    </motion.div>
  );

  if (isAuthenticated) {
    return <AppShell title="Pricing">{body}</AppShell>;
  }

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

      <main className="max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-8">
        {body}
      </main>
    </div>
  );
}
