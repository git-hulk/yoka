// Categorical identity palette. Six cool mid-dark hues used to mark each
// subscription with a consistent color across the app (Home rows, Detail
// header, Cadence sparkline). Purely wayfinding — not the brand accent
// (which is green, see tailwind.config.js), so green is deliberately
// absent here. All hold up as small text on white.
export const SUBSCRIPTION_COLORS = [
  "#2563EB", // blue
  "#0D9488", // teal
  "#7C3AED", // violet
  "#B45309", // amber
  "#BE123C", // rose
  "#64748B", // slate
] as const;

export function subscriptionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return SUBSCRIPTION_COLORS[Math.abs(h) % SUBSCRIPTION_COLORS.length];
}
