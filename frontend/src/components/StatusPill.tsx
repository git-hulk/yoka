import type { PaceColor } from "../lib/pace";

interface Props {
  color: PaceColor;
  label: string;
}

const DOT: Record<PaceColor, string> = {
  green: "bg-pace-green",
  amber: "bg-pace-amber",
  red:   "bg-pace-red",
};

const TEXT: Record<PaceColor, string> = {
  green: "text-pace-green",
  amber: "text-pace-amber",
  red:   "text-pace-red",
};

export default function StatusPill({ color, label }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[11px] uppercase tracking-micro ${TEXT[color]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT[color]}`} aria-hidden="true" />
      {label}
    </span>
  );
}
