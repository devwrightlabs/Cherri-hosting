/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Enterprise gold accent palette, anchored on the brand accent
         * #F0C040. The palette name `cherry` is preserved for backwards
         * compatibility with existing utility classes (e.g. `text-cherry-400`,
         * `bg-cherry-500`); the values map to gold shades so the rendered UI
         * matches the #0A0A0F / #F0C040 enterprise dark theme.
         */
        cherry: {
          50: '#fdf8e8',
          100: '#fbf0c8',
          200: '#f7e394',
          300: '#f3d566',
          400: '#f0c040', // primary accent
          500: '#e0aa1e',
          600: '#b88815',
          700: '#8c6610',
          800: '#66490b',
          900: '#3d2b06',
          950: '#1f1503',
        },
        /** Direct semantic alias for the brand accent. */
        accent: {
          DEFAULT: '#f0c040',
          50: '#fdf8e8',
          100: '#fbf0c8',
          200: '#f7e394',
          300: '#f3d566',
          400: '#f0c040',
          500: '#e0aa1e',
          600: '#b88815',
          700: '#8c6610',
          800: '#66490b',
          900: '#3d2b06',
          950: '#1f1503',
        },
        /**
         * Spec design tokens (Sherry Hosting master prompt §2).
         * Gold = primary action, used at most once per screen.
         */
        gold: {
          DEFAULT: '#f0c040',
          dim: '#b8923a', // pressed / disabled gold
        },
        /** Live / success state (deploy is live, connected). */
        live: {
          DEFAULT: '#3ddc84',
        },
        /** Text tokens. */
        ink: {
          DEFAULT: '#ececf2', // primary text
          mut: '#8a8a99', // muted text
        },
        /** Hairline border token (#22222E). */
        hairline: '#22222e',
        /**
         * Surface scale aligned to the spec tokens:
         *   950 = --bg        #0A0A0F
         *   900 = --surface    #101018
         *   800 = --surface-2  #16161F
         *   700 = --border     #22222E
         * Numeric keys preserved for backwards compatibility with existing
         * utility usages; DEFAULT/2 added as semantic aliases.
         */
        surface: {
          DEFAULT: '#101018',
          2: '#16161f',
          950: '#0a0a0f', // --bg
          900: '#101018', // --surface
          800: '#16161f', // --surface-2
          700: '#22222e', // --border
          600: '#2e2e44',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        /**
         * Gold accent gradient. Kept under the `cherry-gradient` key so
         * existing `bg-cherry-gradient` utility usages continue to work.
         */
        'cherry-gradient': 'linear-gradient(135deg, #f4cb55 0%, #e0b43c 100%)',
        'accent-gradient': 'linear-gradient(135deg, #f4cb55 0%, #e0b43c 100%)',
        'gold-gradient': 'linear-gradient(135deg, #f4cb55 0%, #e0b43c 100%)',
        'dark-gradient': 'linear-gradient(180deg, #101018 0%, #0a0a0f 100%)',
      },
      boxShadow: {
        gold: '0 8px 28px -6px rgba(240, 192, 64, 0.45)',
        'gold-sm': '0 3px 14px -4px rgba(240, 192, 64, 0.4)',
        live: '0 8px 28px -6px rgba(61, 220, 132, 0.4)',
        card: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -16px rgba(0, 0, 0, 0.8)',
        sheet: '0 -8px 40px -8px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'fade-up': 'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        'stamp-in': 'stampIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        'ring-spin': 'ringSpin 1s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        stampIn: {
          '0%': { opacity: '0', transform: 'scale(1.6) rotate(-12deg)' },
          '60%': { opacity: '1' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-8deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ringSpin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
};
