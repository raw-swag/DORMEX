/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/client/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#203653',
          container: '#203653',
          dark: '#17283B',
          light: '#4a5f7f',
        },
        secondary: {
          DEFAULT: '#2C8279',
          container: '#E7F2ED',
          hover: '#236B63',
        },
        tertiary: {
          DEFAULT: '#D4B779',
          container: '#FAF4E6',
        },
        navy: {
          950: '#07203c',
          900: '#203653',
          800: '#17283b',
          700: '#263345',
        },
        midnight: {
          bg: '#080F1C',
          nav: '#0D1929',
          card: '#111F32',
          elevated: '#17283D',
          inset: '#0A1626',
          border: '#293B52',
          'border-subtle': '#1B2C42',
          text: '#F1F5F9',
          'text-secondary': '#B7C6D8',
          'text-muted': '#91A4BA',
          teal: '#63D6C6',
          'teal-hover': '#82E6D8',
          blue: '#60A5FA',
        },
        surface: {
          DEFAULT: '#f6fafc',
          dim: '#d6dbdd',
          bright: '#f6fafc',
          lowest: '#ffffff',
          low: '#f0f4f6',
          container: '#eaeef0',
          high: '#e5e9eb',
          highest: '#dfe3e5',
          ivory: '#F7F6F1',
          mint: '#E7F2ED',
          50: '#F7F6F1',
          100: '#f0f4f6',
          200: '#E2E6E8',
        },
        'on-surface': '#263345',
        'on-surface-variant': '#627084',
        'outline-neutral': '#E2E6E8',
        brand: {
          navy: '#203653',
          teal: '#2C8279',
          tealHover: '#236B63',
          gold: '#D4B779',
          mint: '#E7F2ED',
          ivory: '#F7F6F1',
          darkText: '#263345',
          mutedText: '#627084',
          border: '#E2E6E8',
        },
        status: {
          available: '#1E7B54',
          intent: '#E06A26',
          occupied: '#C93B3B',
          selected: '#1D63B8',
          warning: '#D97706',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
};
