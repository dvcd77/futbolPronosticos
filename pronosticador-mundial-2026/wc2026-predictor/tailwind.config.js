/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      colors: {
        night: {
          900: '#070D1B',
          800: '#0A1225',
          700: '#0D172E',
          600: '#112038',
          500: '#162844',
          400: '#1C3254',
          300: '#234064',
        },
        teal: {
          glow: '#00D4AA',
          mid: '#00B894',
          dark: '#009679',
        },
        amber: {
          glow: '#F5A623',
          mid: '#E09318',
          dark: '#C47D10',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fill-bar': 'fillBar 0.8s ease-out forwards',
      },
    },
  },
  plugins: [],
}
