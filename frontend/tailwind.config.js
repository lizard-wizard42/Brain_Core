/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#191919',
          hover: 'rgba(255,255,255,0.04)',
          active: 'rgba(255,255,255,0.07)',
          border: '#1f1f1f',
        },
        sidebar: '#111111',
        accent: '#7c6af7',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      maxWidth: {
        editor: '720px',
      },
    },
  },
  plugins: [],
};
