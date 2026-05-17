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
        // Brand colors
        brand: {
          DEFAULT: "#004D56",
          light: "#006670",
        },
        // Theme variables
        background: "var(--bg)",
        foreground: "var(--ink)",
        // Sidebar
        sidebar: {
          DEFAULT: "#1E2D2F",
        },
        // Surface colors
        surface: {
          DEFAULT: "#f4f4f5",
          2: "#303035",
        },
        // Card
        card: {
          DEFAULT: "#ffffff",
          dark: "#252528",
        },
        // Text colors
        ink: {
          DEFAULT: "#1a1a1a",
          mid: "#555555",
          light: "#888888",
          faint: "#cccccc",
        },
        // Lines
        line: {
          DEFAULT: "#E0E0E1",
          dark: "rgba(255,255,255,.1)",
        },
        // Artist colors
        artist: {
          olga: "#5B8C7A",
          yulia: "#6B7E9C",
          anastasia: "#A07060",
          darya: "#7A6E9C",
          aleksandra: "#8A7840",
          irina: "#9A5870",
        },
        // Status colors
        status: {
          confirmed: "#10b981",
          cancelled: "#ef4444",
          noShow: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 4px rgba(0,0,0,.08)",
        "card-hover": "0 4px 14px rgba(0,0,0,.13)",
        collapse: "0 1px 4px rgba(0,0,0,.12)",
        panel: "0 2px 10px rgba(0,0,0,.1)",
        toast: "0 4px 20px rgba(0,0,0,.2)",
        popup: "0 8px 32px rgba(0,0,0,.14)",
      },
      borderRadius: {
        card: "12px",
        button: "8px",
      },
      spacing: {
        "sidebar": "230px",
        "sidebar-collapsed": "56px",
        "right-panel": "260px",
        "time-col": "64px",
        "cell": "60px",
      },
      transitionDuration: {
        sidebar: "220ms",
        card: "150ms",
        toast: "180ms",
      },
    },
  },
  plugins: [],
};
export default config;
