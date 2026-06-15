import { TIER_LABELS } from '../../lib/constants';

interface TierBadgeProps {
  tier: string;
  className?: string;
}

/**
 * Identity pill for a plan tier. Paid tiers carry the gold treatment; the free
 * tier stays neutral so gold only ever signals "upgraded".
 */
export default function TierBadge({ tier, className = '' }: TierBadgeProps) {
  const label = TIER_LABELS[tier] ?? tier;
  const isPaid = tier !== 'FREE';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        isPaid
          ? 'bg-gold/15 text-gold border-gold/30'
          : 'bg-surface-700 text-ink-mut border-hairline'
      } ${className}`}
    >
      {isPaid && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 7.1-1.01z" />
        </svg>
      )}
      {label}
    </span>
  );
}
