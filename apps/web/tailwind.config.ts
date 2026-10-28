import type { Config } from 'tailwindcss';

// Emerald-and-white design system. Deliberately no blue in the palette.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#064E3B', 50: '#ECFDF5', 900: '#022C22', 800: '#064E3B', 700: '#065F46' },
        brand: { DEFAULT: '#059669', 50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857', 800: '#065F46', 900: '#064E3B' },
        mint: '#D1FAE5',
        // Warm neutral canvas (stone) behind white cards; emerald stays the accent.
        warm: '#F7F6F2',
        ink: { DEFAULT: '#334155', soft: '#64748B', strong: '#0F172A' },
        amber: { 50: '#FFFBEB', 100: '#FEF3C7', 500: '#F59E0B', 600: '#D97706', 700: '#B45309' },
        rose: { 50: '#FFF1F2', 100: '#FFE4E6', 500: '#F43F5E', 600: '#E11D48', 700: '#BE123C' },
        line: '#E7E5E0',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04)',
        lift: '0 8px 30px rgba(6,78,59,0.12)',
        sos: '0 0 0 12px rgba(225,29,72,0.12), 0 0 0 26px rgba(225,29,72,0.06)',
      },
      keyframes: {
        pulseRing: { '0%': { transform: 'scale(0.9)', opacity: '0.7' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        stepIn: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: { 'pulse-ring': 'pulseRing 1.8s ease-out infinite', 'step-in': 'stepIn 260ms ease-out' },
    },
  },
  plugins: [],
};
export default config;
