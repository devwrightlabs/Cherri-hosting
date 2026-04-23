import { Link } from 'react-router-dom';
import { usePiAuth } from '../hooks/usePiAuth';
import Button from '../components/ui/Button';

const features = [
  {
    icon: '🚀',
    title: '1-Click Deploy',
    description:
      'Drag and drop your static site. We handle the IPFS upload, pinning, and CDN automatically.',
  },
  {
    icon: '🌐',
    title: 'IPFS-Native',
    description:
      'Every deployment is content-addressed. Your site lives on the decentralised web forever.',
  },
  {
    icon: '🍒',
    title: 'Pi Payments',
    description:
      'Pay with Pi cryptocurrency. No credit cards, no KYC — just your Pi wallet.',
  },
  {
    icon: '🔒',
    title: 'Pi Auth',
    description:
      'Sign in with your Pi Network identity. One account across the entire Pi ecosystem.',
  },
  {
    icon: '📊',
    title: 'Real-time Dashboard',
    description:
      'Track deployments, storage usage, and bandwidth from a beautiful developer dashboard.',
  },
  {
    icon: '⚡',
    title: 'Instant Previews',
    description:
      'Every deployment gets a unique IPFS gateway URL you can share immediately.',
  },
];

const tiers = [
  {
    name: 'Free',
    price: '0 Pi',
    period: 'forever',
    storage: '500 MB',
    features: ['Up to 500 MB storage', 'Unlimited deployments', 'IPFS gateway URLs', 'Pi authentication'],
    cta: 'Get started free',
    highlight: false,
  },
  {
    name: 'Premium',
    price: '10 Pi',
    period: '/ month',
    storage: '10 GB',
    features: [
      '10 GB storage',
      'Unlimited deployments',
      'Custom domain support',
      'Priority pinning',
      'Priority support',
    ],
    cta: 'Upgrade to Premium',
    highlight: true,
  },
];

export default function Landing() {
  const { isAuthenticated, isLoading, error, signIn } = usePiAuth();

  return (
    <div className="min-h-screen bg-dark-gradient">
      {/* Nav */}
      <header className="border-b border-surface-700/50 bg-surface-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">🍒</span>
            <span className="font-bold text-white text-xl">Cherri Hosting</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/pricing" className="text-surface-400 hover:text-white text-sm transition-colors">
              Pricing
            </Link>
            {isAuthenticated ? (
              <Link to="/dashboard">
                <Button size="sm">Dashboard</Button>
              </Link>
            ) : (
              <Button size="sm" onClick={signIn} isLoading={isLoading}>
                Sign in with Pi
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cherry-500/10 border border-cherry-500/20 text-cherry-400 text-sm mb-8">
          <span className="w-2 h-2 rounded-full bg-cherry-500 animate-pulse-slow" />
          Decentralised web hosting on IPFS
        </div>

        <h1 className="text-5xl sm:text-7xl font-bold text-white mb-6 leading-tight">
          Deploy sites to{' '}
          <span className="cherry-text">the permanent web</span>
        </h1>

        <p className="text-xl text-surface-400 max-w-2xl mx-auto mb-10">
          Upload your static site, get an IPFS URL in seconds. Pay with Pi. No
          credit cards. No servers. No lock-in.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {isAuthenticated ? (
            <Link to="/deploy">
              <Button size="lg">🚀 Deploy now</Button>
            </Link>
          ) : (
            <Button size="lg" onClick={signIn} isLoading={isLoading}>
              🍒 Sign in with Pi
            </Button>
          )}
          <Link to="/pricing">
            <Button size="lg" variant="secondary">
              View pricing
            </Button>
          </Link>
        </div>

        {error && (
          <p className="mt-4 text-red-400 text-sm">{error}</p>
        )}
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">
          Everything you need to ship
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="glass rounded-xl p-6 hover:border-cherry-500/30 transition-colors"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-surface-400 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-3">Simple pricing</h2>
        <p className="text-surface-400 text-center mb-12">Pay with Pi. Cancel anytime.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl p-8 flex flex-col gap-5 ${
                tier.highlight
                  ? 'bg-cherry-gradient p-px'
                  : 'glass'
              }`}
            >
              {tier.highlight ? (
                <div className="bg-surface-900 rounded-[11px] p-7 flex flex-col gap-5 h-full">
                  <TierContent tier={tier} isAuthenticated={isAuthenticated} signIn={signIn} isLoading={isLoading} />
                </div>
              ) : (
                <TierContent tier={tier} isAuthenticated={isAuthenticated} signIn={signIn} isLoading={isLoading} />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-700/50 py-8 text-center text-surface-500 text-sm">
        <p>© {new Date().getFullYear()} Cherri Hosting. Built on IPFS & Pi Network.</p>
      </footer>
    </div>
  );
}

function TierContent({
  tier,
  isAuthenticated,
  signIn,
  isLoading,
}: {
  tier: (typeof tiers)[number];
  isAuthenticated: boolean;
  signIn: () => void;
  isLoading: boolean;
}) {
  return (
    <>
      <div>
        <h3 className="text-lg font-bold text-white">{tier.name}</h3>
        <div className="flex items-baseline gap-1 mt-2">
          <span className="text-3xl font-bold text-white">{tier.price}</span>
          <span className="text-surface-400 text-sm">{tier.period}</span>
        </div>
      </div>
      <ul className="space-y-2.5 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-surface-300">
            <span className="text-cherry-400">✓</span>
            {f}
          </li>
        ))}
      </ul>
      {isAuthenticated ? (
        <Link to={tier.name === 'Free' ? '/dashboard' : '/pricing'}>
          <Button variant={tier.highlight ? 'primary' : 'secondary'} className="w-full justify-center">
            {tier.cta}
          </Button>
        </Link>
      ) : (
        <Button
          variant={tier.highlight ? 'primary' : 'secondary'}
          className="w-full justify-center"
          onClick={signIn}
          isLoading={isLoading}
        >
          {tier.cta}
        </Button>
      )}
    </>
  );
}
