import type { PaceColor } from "../lib/pace";

interface Props {
  color: PaceColor;
  /** 0..1 fraction of bar to fill. */
  filled: number;
  /** Both omitted = no label row, just the bar. */
  leftLabel?: string;
  rightLabel?: string;
  /** "lg" gets a thicker bar — used on the detail page. */
  size?: "md" | "lg";
}

const FILL: Record<PaceColor, string> = {
  green: "bg-pace-green",
  amber: "bg-pace-amber",
  red:   "bg-pace-red",
};

export default function TrackBand({
  color, filled, leftLabel, rightLabel, size = "md",
}: Props) {
  const barHeight = size === "lg" ? "h-2.5" : "h-1.5";

  const filledPct = clampPct(filled);
  const hasLabels = leftLabel !== undefined || rightLabel !== undefined;

  return (
    <div className={hasLabels ? "space-y-2" : ""}>
      <div className={`relative w-full overflow-hidden rounded-full bg-ink/10 ${barHeight}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out ${FILL[color]}`}
          style={{ width: `${filledPct}%` }}
          aria-hidden="true"
        />
      </div>
      {hasLabels && (
        <div className="num flex justify-between text-xs text-ink-dim">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}

function clampPct(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(100, Math.max(0, x * 100));
}
