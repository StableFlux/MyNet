/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        glass: {
          DEFAULT: 'rgba(255,255,255,0.055)',
          border: 'rgba(255,255,255,0.09)',
          hover: 'rgba(255,255,255,0.09)',
        },
        surface: {
          DEFAULT: '#0d1117',
          raised: '#111827',
          overlay: '#1a2236',
        },
      },
      backdropBlur: {
        glass: '16px',
      },
      boxShadow: {
        glass: '0 4px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
        glow: '0 0 20px rgba(99,102,241,0.35)',
        'glow-sm': '0 0 12px rgba(99,102,241,0.25)',
      },
    },
  },
  plugins: [],
}
