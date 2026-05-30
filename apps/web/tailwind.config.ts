import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#004D56", light: "#006670" },
        gold: "#C49A2E",
        ink: { DEFAULT: "#1a1a1a", mid: "#555555", light: "#888888", faint: "#cccccc" },
        surface: { DEFAULT: "#f4f4f5" },
        line: { DEFAULT: "#E0E0E1" },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        display: ["Playfair Display", "serif"],
      },
      borderRadius: {
        card: "16px",
        button: "8px",
      },
      boxShadow: {
        "site-card": "0 2px 16px rgba(0,0,0,.09)",
      },
    },
  },
  plugins: [],
};
export default config;
