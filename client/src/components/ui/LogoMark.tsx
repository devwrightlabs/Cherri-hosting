interface LogoMarkProps {
  /** Pixel size of the square mark. */
  size?: number;
  className?: string;
}

/**
 * Sherry Hosting logo mark — a geometric "permanent node" glyph: a gold node
 * pinned inside an orbit ring, evoking content pinned to the decentralized web.
 * No emoji (acceptance criterion #7).
 */
export default function LogoMark({ size = 28, className = '' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sherry-gold" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F4CB55" />
          <stop offset="1" stopColor="#E0B43C" />
        </linearGradient>
      </defs>
      {/* Orbit ring */}
      <circle cx="16" cy="16" r="13" stroke="url(#sherry-gold)" strokeWidth="2" opacity="0.4" />
      {/* Pinned node */}
      <path
        d="M16 6 L24.66 11 V21 L16 26 L7.34 21 V11 Z"
        fill="url(#sherry-gold)"
      />
      <circle cx="16" cy="16" r="3.4" fill="#0A0A0F" />
    </svg>
  );
}
