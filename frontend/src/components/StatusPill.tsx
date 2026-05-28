import type { PaceColor } from "../lib/pace";
import type { Status } from "../lib/types";

interface Props {
  status: Status;
  color:  PaceColor;
  label:  string;
}

// GH "label" cadence: rounded pill with a tinted fill, a hairline-tinted
// border, and the full pace color for text. Leading status mark carries
// the verdict on its own — color is reinforcement, not the only cue.
const PILL: Record<PaceColor, string> = {
  green: "border-pace-green/25 bg-track-green text-pace-green",
  amber: "border-pace-amber/25 bg-track-amber text-pace-amber",
  red:   "border-pace-red/25   bg-track-red   text-pace-red",
};

export default function StatusPill({ status, color, label }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PILL[color]}`}
    >
      <StatusMark status={status} />
      {label}
    </span>
  );
}

// Each status gets its own glyph so the verdict reads without parsing color:
//   active    — filled dot, pulsing halo (the only live state)
//   not_start — hollow ring (awaiting)
//   done      — filled square (editorial "fin" mark)
//   expired   — struck cross
function StatusMark({ status }: { status: Status }) {
  switch (status) {
    case "active":
      return (
        <span
          className="relative inline-flex size-2 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute inset-0 rounded-full bg-current opacity-25 motion-safe:animate-breathe" />
          <span className="relative size-[5px] rounded-full bg-current" />
        </span>
      );
    case "not_start":
      return (
        <span
          className="size-2 rounded-full border-[1.5px] border-current"
          aria-hidden="true"
        />
      );
    case "done":
      return (
        <span
          className="size-[7px] bg-current"
          aria-hidden="true"
        />
      );
    case "expired":
      return (
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
          <path
            d="M2 2 L8 8 M8 2 L2 8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
