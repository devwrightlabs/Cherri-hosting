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
        surface: {
          950: '#0a0a0f', // enterprise dark base
          900: '#111118',
          800: '#1a1a26',
          700: '#242435',
          600: '#2e2e44',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        /**
         * Gold accent gradient. Kept under the `cherry-gradient` key so
         * existing `bg-cherry-gradient` utility usages continue to work.
         */
'cherry-gradient': 'linear-gradient(135deg, #f0c040 0%, #c99a1a 100%)',
        'accent-gradient': 'linear-gradient(135deg, #f0c040 0%, #c99a1a 100%)'
        'dark-gradient': 'linear-gradient(180deg, #111118 0%, #0a0a0f 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
