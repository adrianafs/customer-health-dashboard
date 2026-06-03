import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'monospace'],
      },
      colors: {
        surface: '#13131a',
        base: '#0d0d12',
        border: 'rgba(255,255,255,0.07)',
        stable: '#22c55e',
        moderate: '#f59e0b',
        action: '#f97316',
        churn: '#ef4444',
      },
    },
  },
  plugins: [],
}

export default config
