interface SkeletonProps {
  className?: string;
}

/**
 * A neutral shimmering placeholder used while content loads. Compose multiple
 * Skeletons to mirror the shape of the content that will replace them, so the
 * layout does not shift when data arrives.
 */
export default function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-surface-700/60 ${className}`}
      aria-hidden="true"
    />
  );
}
