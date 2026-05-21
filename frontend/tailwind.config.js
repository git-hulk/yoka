/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Editorial pace palette — forest, antique gold, oxblood.
        // Quieter than retina-green/amber/red; reads as ink with hue.
        pace: {
          green: "#2E6F4F",
          amber: "#9C6B16",
          red:   "#9E3527",
        },
        // Soft washes used for fill backgrounds and status pills.
        track: {
          green:   "#2E6F4F14",
          amber:   "#9C6B1614",
          red:     "#9E352714",
          neutral: "#1A18140F",
        },
        ink: {
          DEFAULT: "#1A1814",
          dim:     "#5C544A",
          faint:   "#8E8675",
        },
        // Warm paper system. canvas = desk, surface = the page.
        canvas:   "#FFFFFF",
        surface:  "#FFFFFF",
        hairline: "#D9D2BF",
        // Fountain-pen ink. The brand color. Restrained: primary action,
        // brand mark, focus, hover. Never decoration.
        accent: {
          DEFAULT: "#1E3A5F",
          soft:    "#1E3A5F14",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter Fallback",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        serif: [
          "Source Serif 4",
          "Source Serif Fallback",
          "ui-serif",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
      boxShadow: {
        // Editorial: surfaces sit on the page, they don't float.
        page: "0 1px 0 rgba(26, 24, 20, 0.04)",
      },
      letterSpacing: {
        micro: "0.14em",
      },
      keyframes: {
        // Slow heart-pulse for the active status mark. Halo expands and
        // brightens, then settles — calm, not alarming.
        breathe: {
          "0%, 100%": { opacity: "0.2", transform: "scale(1)" },
          "50%":      { opacity: "0.5", transform: "scale(1.5)" },
        },
        // Calendar motion. Short, decisive, product-register timings.
        backdropIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        modalIn: {
          "0%":   { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0)    scale(1)" },
        },
        chipIn: {
          "0%":   { opacity: "0", transform: "translateY(-2px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0)    scale(1)" },
        },
        rowIn: {
          "0%":   { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        gridIn: {
          "0%":   { opacity: "0", transform: "translateY(3px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        breathe:    "breathe 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        backdropIn: "backdropIn 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        modalIn:    "modalIn 240ms cubic-bezier(0.16, 1, 0.3, 1) both",
        chipIn:     "chipIn 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        rowIn:      "rowIn 280ms cubic-bezier(0.22, 1, 0.36, 1) both",
        gridIn:     "gridIn 260ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
