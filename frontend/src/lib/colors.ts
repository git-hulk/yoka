// Editorial identity palette. Six tinted ink colors, balanced cool/warm,
// used to mark each subscription with a consistent color across the app
// (Home rows, Detail header, Cadence sparkline). This palette is purely
// categorical wayfinding — not the brand accent (which is green, see
// tailwind.config.js). Navy lives here because it's a useful distinct hue
// for subscriptions, not because the app is "branded navy".
export const SUBSCRIPTION_COLORS = [
  "#1E3A5F", // deep ink navy
  "#2E6F4F", // forest
  "#9C6B16", // gold
  "#9E3527", // oxblood
  "#5C544A", // slate
  "#5C7A52", // sage
] as const;

export function subscriptionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return SUBSCRIPTION_COLORS[Math.abs(h) % SUBSCRIPTION_COLORS.length];
}
