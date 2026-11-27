/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        cinzel: ['Fondamento', '"Eagle Lake"', 'Cinzel', 'Georgia', 'serif'],
        sans: ['Kurale', 'Georgia', '"PingFang SC"', '"Noto Sans SC"', 'serif'],
      },
    },
  },
  plugins: [],
};
