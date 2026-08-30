/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * NEW THEME: Cyan/Teal primary (#06B6D4), Deep Blue secondary (#0C4A6E)
         * Dark mode surfaces with high contrast.
         */
        primary: {
          DEFAULT: '#06B6D4', // Cyan - primary buttons, active states
          light: '#22D3EE',   // Light cyan
          dark: '#0891B2',    // Dark cyan
          muted: '#06B6D4',   // Muted cyan
        },
        secondary: {
          DEFAULT: '#0C4A6E', // Deep Blue - secondary actions
          light: '#1e40af',   // Light blue
          dark: '#082f49',    // Dark blue
        },
        /**
         * Keep cherry/gold for backward compatibility but remap to primary.
         */
        cherry: {
          400: '#06B6D4',
          500: '#0891B2',
        },
        accent: {
          DEFAULT: '#06B6D4',
          400: '#06B6D4',
          500: '#0891B2',
        },
        gold: {
          DEFAULT: '#06B6D4',
          dim: '#0891B2',
        },
        /** Live / success state (deploy is live, service connected). */
        live: {
          DEFAULT: '#10b981',
        },
        /** Text tokens — Devright Labs spec. */
        ink: {
          DEFAULT: '#FFFFFF', // primary text
          mut: '#A0A0B0',     // secondary/muted text
        },
        /** Hairline border token. */
        hairline: '#2a2f3a',
        /**
         * Dark-premium surface scale.
         */
        surface: {
          DEFAULT: '#1A1A24',
          2: '#22222E',
          950: '#0A0A0F',
          900: '#1A1A24',
          800: '#22222E',
          700: '#2a2f3a',
          600: '#373d4c',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        /**
         * NEW: Cyan/Teal gradients
         */
        'cherry-gradient': 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)',
        'accent-gradient': 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)',
        'gold-gradient':   'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)',
        'dark-gradient':   'linear-gradient(180deg, #1A1A24 0%, #0A0A0F 100%)',
        /** Hero splash gradient — cyan → deep blue. */
        'hero-gradient':   'linear-gradient(135deg, #06B6D4 0%, #0C4A6E 100%)',
      },
      boxShadow: {
        gold:      '0 8px 28px -6px rgba(6, 182, 212, 0.45)',
        'gold-sm': '0 3px 14px -4px rgba(6, 182, 212, 0.40)',
        live:      '0 8px 28px -6px rgba(16, 185, 129, 0.40)',
        card:      '0 1px 2px rgba(0,0,0,0.6), 0 8px 24px -16px rgba(0,0,0,0.95)',
        sheet:     '0 -8px 40px -8px rgba(0,0,0,0.7)',
        /** Focus ring glow for cyan-active states. */
        'gold-focus': '0 0 0 3px rgba(6, 182, 212, 0.35)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-in-out',
        'fade-up':    'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in':   'scaleIn 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        'stamp-in':   'stampIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        shimmer:      'shimmer 1.6s linear infinite',
        'ring-spin':  'ringSpin 1s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%':   { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        stampIn: {
          '0%':   { opacity: '0', transform: 'scale(1.6) rotate(-12deg)' },
          '60%':  { opacity: '1' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-8deg)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ringSpin: {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(6, 182, 212, 0.3)' },
          '50%':      { boxShadow: '0 0 28px rgba(6, 182, 212, 0.6)' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
