/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['"Work Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ground: 'var(--ground)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        ink: 'var(--ink)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        accentInk: 'var(--accent-ink)',
        accentSoft: 'var(--accent-soft)',
        watch: 'var(--watch)',
        watchSoft: 'var(--watch-soft)',
        done: 'var(--done)',
        danger: 'var(--danger)',
      },
    },
  },
  plugins: [],
}
