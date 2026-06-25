/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Teal accent palette — Cherri's premium identity colour.
         * The palette key `cherry` is preserved so all existing utility
         * classes (e.g. `text-cherry-400`, `bg-cherry-500`) continue to work
         * without a codebase-wide rename; values map to teal shades.
         */
        cherry: {
          50: '#f0fffe',
          100: '#ccfffe',
          200: '#99f9f6',
          300: '#5cf2ee',
          400: '#0fb5ae', // primary teal
          500: '#0c9a94', // hover teal
          600: '#0a8580',
          700: '#086f6a',
          800: '#065a56',
          900: '#044845',
          950: '#022825',
        },
        /** Direct semantic alias — exact same values as cherry. */
        accent: {
          DEFAULT: '#0fb5ae',
          50: '#f0fffe',
          100: '#ccfffe',
          200: '#99f9f6',
          300: '#5cf2ee',
          400: '#0fb5ae',
          500: '#0c9a94',
          600: '#0a8580',
          700: '#086f6a',
          800: '#065a56',
          900: '#044845',
          950: '#022825',
        },
        /**
         * Semantic action token — maps to the primary teal accent.
         * Use `text-gold`, `bg-gold`, `border-gold`, etc.
         */
        gold: {
          DEFAULT: '#0fb5ae',
          dim: '#0a8580', // pressed / disabled
        },
        /** Live / success state (deploy is live, service connected). */
        live: {
          DEFAULT: '#10b981',
        },
        /** Text tokens. */
        ink: {
          DEFAULT: '#f4f5f7', // primary text
          mut: '#9ca0ad',     // muted text
        },
        /** Hairline border token. */
        hairline: '#2a2f3a',
        /**
         * Dark-premium surface scale:
         *   950 = --bg          #0F1117  (page background)
         *   900 = --surface     #181B23  (card background)
         *   800 = --surface-2   #20242E  (input / inner card)
         *   700 = --border      #2A2F3A  (dividers)
         *   600                 #373D4C  (strong dividers / inactive)
         */
        surface: {
          DEFAULT: '#181b23',
          2: '#20242e',
          950: '#0f1117',
          900: '#181b23',
          800: '#20242e',
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
         * Teal accent gradient — retained under both old and new key names
         * so existing `bg-cherry-gradient`, `bg-gold-gradient` classes work.
         */
        'cherry-gradient': 'linear-gradient(135deg, #16c4bd 0%, #0c9a94 100%)',
        'accent-gradient': 'linear-gradient(135deg, #16c4bd 0%, #0c9a94 100%)',
        'gold-gradient':   'linear-gradient(135deg, #16c4bd 0%, #0c9a94 100%)',
        'dark-gradient':   'linear-gradient(180deg, #181b23 0%, #0f1117 100%)',
        /** Hero splash gradient — teal → indigo. */
        'hero-gradient':   'linear-gradient(135deg, #0fb5ae 0%, #5b5bd6 100%)',
      },
      boxShadow: {
        gold:    '0 8px 28px -6px rgba(15, 181, 174, 0.45)',
        'gold-sm': '0 3px 14px -4px rgba(15, 181, 174, 0.4)',
        live:    '0 8px 28px -6px rgba(16, 185, 129, 0.4)',
        card:    '0 1px 2px rgba(0, 0, 0, 0.5), 0 8px 24px -16px rgba(0, 0, 0, 0.9)',
        sheet:   '0 -8px 40px -8px rgba(0, 0, 0, 0.7)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-in-out',
        'fade-up':    'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in':   'scaleIn 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        'stamp-in':   'stampIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        shimmer:      'shimmer 1.6s linear infinite',
        'ring-spin':  'ringSpin 1s linear infinite',
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
      },
    },
  },
  plugins: [],
};
