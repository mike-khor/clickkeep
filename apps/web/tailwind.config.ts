import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f7f8',
          100: '#eeeef0',
          200: '#d8d8de',
          300: '#b8b8c2',
          400: '#878793',
          500: '#5a5a66',
          600: '#3f3f48',
          700: '#2a2a31',
          800: '#1a1a1f',
          900: '#0e0e12',
        },
        accent: {
          DEFAULT: '#f97316',
          50: '#fff7ed',
          500: '#f97316',
          600: '#ea580c',
        },
      },
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
