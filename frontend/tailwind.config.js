/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy:  { DEFAULT: '#0D2B4F', light: '#1a3d6b' },
        teal:  { DEFAULT: '#007A8A', light: '#009aad', pale: '#EBF5F7' },
        brand: { bg: '#F0F5FA' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
