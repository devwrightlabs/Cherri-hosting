import { Link } from 'react-router-dom';
import { usePiAuth } from '../hooks/usePiAuth';
import LogoMark from '../components/ui/LogoMark';
import Button from '../components/ui/Button';

const valueRows = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: 'Permanent storage',
    description: 'Every deploy is content-addressed on IPFS — it lives on the decentralised web.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 8h6M10 8v8M14 8v8" />
      </svg>
    ),
    title: 'Pi-native payments',
    description: 'Pay with Pi from your wallet. No credit cards, no KYC, no lock-in.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 10 17l9-10" />
      </svg>
    ),
    title: 'One-tap deploy',
    description: 'Drop a folder or ZIP. We upload, pin and give you a live URL in seconds.',
  },
];

const features = [
  { title: '1-tap deploy', description: 'Drag a folder or ZIP. We handle the IPFS upload, pinning and gateway URL.' },
  { title: 'IPFS-native', description: 'Every deployment is content-addressed and permanent on the decentralised web.' },
  { title: 'Pi payments', description: 'Pay with Pi cryptocurrency — no credit cards, no KYC.' },
  { title: 'Pi auth', description: 'Sign in with your Pi Network identity, one account across the ecosystem.' },
  { title: 'Live dashboard', description: 'Track deployments, storage and plan from a mobile-native dashboard.' },
  { title: 'Instant previews', description: 'Every deployment gets a shareable IPFS gateway URL immediately.' },
];

const tiers = [
  {
    name: 'Free',
    price: '0 π',
    period: 'forever',
    features: ['500 MB storage', 'Unlimited deployments', 'IPFS gateway URLs', 'Pi authentication'],
    highlight: false,
  },
  {
    name: 'Tier 2',
    price: '35 π',
    period: '/ month',
    features: ['10 GB storage', '5 Pi domains', 'Multi-domain mapping', 'Priority support'],
    highlight: true,
  },
];

export default function Landing() {
  const { isAuthenticated, isLoading, error, signIn } = usePiAuth();

  return (
    <div className="min-h-[100dvh] bg-dark-gradient overflow-x-hidden">
      {/* Nav */}
      <header className="safe-top sticky top-0 z-50 bg-surface-950/85 backdrop-blur-md border-b border-hairline">
        <div className="h-14 px-4 flex items-center justify-between max-w-screen-sm mx-auto">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark size={26} />
            <span className="font-display font-bold text-ink text-[15px] tracking-tight">
              Cherri Hosting
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/pricing" className="text-ink-mut hover:text-ink text-sm transition-colors">
              Pricing
            </Link>
            {isAuthenticated && (
              <Link to="/dashboard">
                <Button size="sm">Dashboard</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-screen-sm mx-auto px-4">
        {/* Hero */}
        <section className="pt-12 pb-10 text-center animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gold/10 border border-gold/20 text-gold text-xs mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse-slow" />
            Decentralised hosting on IPFS
          </div>

          <h1 className="text-4xl font-bold text-ink font-display leading-[1.1] tracking-tight">
            Deploy to the{' '}
            <span className="gold-text">permanent web</span>
          </h1>

          <p className="text-ink-mut text-base mt-4 max-w-md mx-auto">
            Upload your static site, get an IPFS URL in seconds. Pay with Pi. No
            servers, no lock-in.
          </p>

          <div className="mt-7 flex flex-col gap-3">
            {isAuthenticated ? (
              <Link to="/deploy">
                <Button size="lg" className="w-full justify-center">
                  Deploy now
                </Button>
              </Link>
            ) : (
              <Button
                size="lg"
                className="w-full justify-center"
                onClick={signIn}
                isLoading={isLoading}
              >
                Sign in with Pi
              </Button>
            )}
            <Link to="/pricing">
              <Button size="lg" variant="secondary" className="w-full justify-center">
                View pricing
              </Button>
            </Link>
          </div>

          {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}

          <p className="mt-6 text-ink-mut text-xs">
            Built for Pi Browser · IPFS · Pi Network
          </p>
        </section>

        {/* Value rows */}
        <section className="py-8 space-y-3">
          {valueRows.map((row) => (
            <div
              key={row.title}
              className="flex items-start gap-3 rounded-2xl bg-surface-900 border border-hairline p-4"
            >
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-800 border border-hairline text-gold shrink-0">
                {row.icon}
              </span>
              <div>
                <h3 className="font-semibold text-ink text-sm">{row.title}</h3>
                <p className="text-ink-mut text-sm mt-0.5">{row.description}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Features */}
        <section className="py-8">
          <h2 className="text-xl font-bold text-ink font-display text-center mb-6">
            Everything you need to ship
          </h2>
          <div className="space-y-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl bg-surface-900 border border-hairline p-4"
              >
                <h3 className="font-semibold text-ink text-sm mb-1">{f.title}</h3>
                <p className="text-ink-mut text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing preview */}
        <section className="py-8">
          <h2 className="text-xl font-bold text-ink font-display text-center mb-1">
            Simple pricing
          </h2>
          <p className="text-ink-mut text-sm text-center mb-6">Pay with Pi. Cancel anytime.</p>

          <div className="space-y-4">
            {tiers.map((tier) =>
              tier.highlight ? (
                <div key={tier.name} className="bg-gold-gradient p-px rounded-2xl shadow-gold-sm">
                  <div className="bg-surface-900 rounded-[15px] p-5">
                    <TierContent tier={tier} signIn={signIn} isLoading={isLoading} isAuthenticated={isAuthenticated} />
                  </div>
                </div>
              ) : (
                <div key={tier.name} className="rounded-2xl bg-surface-900 border border-hairline p-5">
                  <TierContent tier={tier} signIn={signIn} isLoading={isLoading} isAuthenticated={isAuthenticated} />
                </div>
              ),
            )}
          </div>

          <Link to="/pricing" className="block text-center mt-5 text-gold text-sm hover:underline">
            See all plans →
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="safe-bottom border-t border-hairline py-6 text-center text-ink-mut text-xs">
        © {new Date().getFullYear()} Cherri Hosting · Built on IPFS &amp; Pi Network
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
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-bold text-ink font-display">{tier.name}</h3>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-3xl font-bold text-ink font-mono">{tier.price}</span>
          <span className="text-ink-mut text-sm">{tier.period}</span>
        </div>
      </div>
      <ul className="space-y-2">
        {tier.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-ink">
            <span className="text-live shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            {f}
          </li>
        ))}
      </ul>
      {isAuthenticated ? (
        <Link to="/dashboard">
          <Button variant={tier.highlight ? 'primary' : 'secondary'} className="w-full justify-center">
            Go to dashboard
          </Button>
        </Link>
      ) : (
        <Button
          variant={tier.highlight ? 'primary' : 'secondary'}
          className="w-full justify-center"
          onClick={signIn}
          isLoading={isLoading}
        >
          Sign in with Pi
        </Button>
      )}
    </div>
  );
}
