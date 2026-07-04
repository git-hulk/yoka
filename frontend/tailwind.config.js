/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic pace palette — burndown health, not brand. Crisp, cool
        // hues tuned to hold AA contrast as small text on white.
        pace: {
          green: "#15803D",
          amber: "#A16207",
          red:   "#C22F2F",
        },
        // Soft washes used for fill backgrounds and status pills.
        track: {
          green:   "#15803D14",
          amber:   "#A1620714",
          red:     "#C22F2F14",
          neutral: "#2328260F",
        },
        // Neutrals carry a whisper of the brand green hue — never pure
        // gray, never pure black.
        ink: {
          DEFAULT: "#232826",
          dim:     "#5F6B65",
          faint:   "#8B968F",
        },
        // Two-layer light system: canvas = app chrome (sidebar, auth
        // pages, out-of-month cells), surface = content panels. subtle is
        // the hover/zebra/table-header wash; hairline draws every 1px
        // border.
        canvas:   "#F9FAF9",
        surface:  "#FFFFFF",
        subtle:   "#F2F4F3",
        hairline: "#E4E7E5",
        // Brand color: green. Used on primary action, brand mark, focus,
        // hover, active states. Pace-status colors (pace.{green,amber,red})
        // stay semantic — those encode burn-down health, not brand.
        accent: {
          DEFAULT: "#15803D",
          // Hover shade for solid-accent controls — darker, never lighter.
          deep:    "#0F6A32",
          soft:    "#15803D14",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter Fallback",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      // Type ramp lifted from the Linear Design System Figma file
      // (see DESIGN.md). 13px is the UI base; weights stop at 500 —
      // Linear never uses semibold/bold in product UI.
      fontSize: {
        "2xs": ["11px", "12px"],
        xs:    ["12px", "15px"],
        sm:    ["13px", "16px"],
        base:  ["15px", "22px"],
        lg:    ["18px", "22px"],
        xl:    ["20px", "24px"],
        "2xl": ["22px", "27px"],
        "3xl": ["24px", "29px"],
        "4xl": ["36px", "44px"],
      },
      boxShadow: {
        // Layered, low-alpha, cool. Borders define edges; shadows only
        // add lift. Three steps: resting panel → popover → dialog.
        page:  "0 1px 2px rgba(20, 24, 22, 0.05)",
        pop:   "0 2px 4px rgba(20, 24, 22, 0.04), 0 8px 24px -4px rgba(20, 24, 22, 0.10)",
        modal: "0 4px 8px rgba(20, 24, 22, 0.04), 0 20px 48px -12px rgba(20, 24, 22, 0.18)",
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
