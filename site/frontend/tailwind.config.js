/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Redefine white to use a CSS variable so all text-white/XX, bg-white/XX,
        // border-white/XX variants automatically adapt to the active theme.
        white: 'rgb(var(--color-white) / <alpha-value>)',
        glass: {
          DEFAULT: 'var(--glass-bg)',
          border: 'var(--glass-border)',
          hover: 'var(--glass-hover)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
        },
      },
      backdropBlur: {
        glass: '16px',
      },
      boxShadow: {
        glass: 'var(--shadow-glass)',
        glow: '0 0 20px rgba(99,102,241,0.35)',
        'glow-sm': '0 0 12px rgba(99,102,241,0.25)',
      },
    },
  },
  plugins: [],
}
