// Editorial identity palette. Six tinted ink colors, balanced cool/warm.
// Used to mark each subscription with a consistent color across the app
// (Home rows, Detail header, Cadence sparkline, Calendar chips). The accent
// navy and the pace status hues are deliberately part of this set: a sub
// happening to carry the same color as its pace reads as alignment, not
// duplication, because the two appear in different positions.
export const SUBSCRIPTION_COLORS = [
  "#1E3A5F", // accent (deep ink navy)
  "#2E6F4F", // pace-green (forest)
  "#9C6B16", // pace-amber (gold)
  "#9E3527", // pace-red (oxblood)
  "#5C544A", // ink-dim (slate)
  "#5C7A52", // sage
] as const;

export function subscriptionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return SUBSCRIPTION_COLORS[Math.abs(h) % SUBSCRIPTION_COLORS.length];
}
