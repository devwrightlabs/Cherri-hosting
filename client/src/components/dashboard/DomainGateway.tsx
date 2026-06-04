import Card from '../ui/Card';
import Button from '../ui/Button';
import { PI_DOMAIN_PORTAL_URL } from '../../lib/constants';

/**
 * Domain redirection gateway.
 *
 * Sherry Hosting is decentralized hosting infrastructure, not a domain
 * reseller. Acquiring a domain — bids, purchases, and billing — happens
 * exclusively on Pi Network's official domain auction. This component makes
 * that separation explicit: it routes users to the official workflow and
 * explains how to map a domain they already own to their IPFS deployment.
 */
export default function DomainGateway() {
  const openPiDomainPortal = () => {
    window.open(PI_DOMAIN_PORTAL_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🌐</span>
        <h2 className="text-sm font-semibold text-white">Custom Pi Domain</h2>
      </div>

      <p className="text-surface-400 text-xs leading-relaxed mb-4">
        Domains are acquired and billed through Pi Network's official domain
        auction — Sherry doesn't sell domains or handle bids. Win a domain on Pi
        Network, then map it to any of your deployments here.
      </p>

      <ol className="space-y-2 mb-4 text-xs text-surface-300">
        <li className="flex gap-2">
          <span className="text-cherry-400 font-mono">1.</span>
          <span>Bid for and acquire your domain on the official Pi Network auction.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-cherry-400 font-mono">2.</span>
          <span>Pi Network handles the purchase and billing — not Sherry.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-cherry-400 font-mono">3.</span>
          <span>
            Point the domain to your deployment's IPFS gateway URL (or its CID via
            DNSLink) shown on each deployment.
          </span>
        </li>
      </ol>

      <Button
        variant="secondary"
        size="sm"
        className="w-full justify-center"
        onClick={openPiDomainPortal}
      >
        Open Pi Network domain auction →
      </Button>
    </Card>
  );
}
