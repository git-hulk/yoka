interface Props {
  /** Daily values, oldest → newest. Length determines the bar count. */
  bins: number[];
  /** Optional pixel height; defaults to a compact 24px reading. */
  heightPx?: number;
  /** Aria label override for screen readers. */
  label?: string;
  /** Optional accent color. When provided, bars take this color (today at
   *  full opacity, prior days at 65%). Used to tie the chart to a specific
   *  subscription's identity. Falls back to accent + ink/60 when omitted. */
  color?: string;
}

// Editorial daily ledger. Bars sit on a hairline baseline so empty days still
// register (a missing day is information). No grid, no axes, no legend; the
// sentence below the chart names the numbers.
//
// Stretches to the container width with `preserveAspectRatio="none"` so the
// rhythm reads at any column width.
export default function Sparkline({ bins, heightPx = 24, label, color }: Props) {
  const VB_H    = 24;
  const VB_W    = 100;
  const days    = Math.max(1, bins.length);
  const slot    = VB_W / days;
  const gap     = slot * 0.28;
  const barW    = slot - gap;
  const max     = Math.max(1, ...bins);
  const lastIdx = days - 1;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? `Daily usage, last ${days} days`}
      className="block w-full"
      style={{ height: `${heightPx}px` }}
    >
      <line
        x1="0"
        x2={VB_W}
        y1={VB_H - 0.4}
        y2={VB_H - 0.4}
        className="stroke-hairline"
        strokeWidth="0.5"
      />
      {bins.map((v, i) => {
        const x = i * slot + gap / 2;
        if (v <= 0) {
          return (
            <rect
              key={i}
              x={x}
              y={VB_H - 0.8}
              width={barW}
              height={0.8}
              className="fill-ink/15"
            />
          );
        }
        const h = Math.max(1.2, (v / max) * (VB_H - 2));
        const isToday = i === lastIdx;
        if (color) {
          return (
            <rect
              key={i}
              x={x}
              y={VB_H - h}
              width={barW}
              height={h}
              fill={color}
              fillOpacity={isToday ? 1 : 0.65}
            />
          );
        }
        return (
          <rect
            key={i}
            x={x}
            y={VB_H - h}
            width={barW}
            height={h}
            className={isToday ? "fill-accent" : "fill-ink/60"}
          />
        );
      })}
    </svg>
  );
}
