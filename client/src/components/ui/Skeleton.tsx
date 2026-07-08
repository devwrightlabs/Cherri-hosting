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
      className={`animate-shimmer rounded-md bg-surface-800 skeleton ${className}`}
      aria-hidden="true"
    />
  );
}
