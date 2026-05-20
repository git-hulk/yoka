import { Link } from "react-router-dom";

import type { Package } from "../lib/types";
import {
  filledFraction,
  paceColor,
  statusLabel,
  tickFraction,
} from "../lib/pace";
import StatusPill from "./StatusPill";
import TrackBand from "./TrackBand";

interface Props {
  pkg: Package;
}

export default function PackageCard({ pkg }: Props) {
  const color = paceColor(pkg);

  return (
    <Link
      to={`/packages/${pkg.id}`}
      className="group relative -mx-4 grid grid-cols-[minmax(0,1.4fr)_minmax(100px,1.3fr)_5rem_4.5rem] items-center gap-4 px-4 py-4 transition duration-300 ease-out hover:bg-accent-soft focus:outline-none sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,1.4fr)_5rem_4.5rem_4.5rem]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="serif truncate text-lg leading-tight text-ink decoration-accent/60 underline-offset-4 group-hover:underline">
          {pkg.name}
        </h2>
        <span
          aria-hidden="true"
          className="-translate-x-1 text-sm leading-none text-accent opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100"
        >
          →
        </span>
      </div>

      <div className="pb-0.5">
        <TrackBand
          color={color}
          filled={filledFraction(pkg)}
          tick={tickFraction(pkg)}
        />
      </div>

      <StatusPill color={color} label={statusLabel(pkg.status)} />

      <span className="num hidden text-right text-xs tabular-nums text-ink-dim sm:inline">
        {shortDate(new Date(pkg.created_at))}
      </span>

      <span className="num text-right text-xs tabular-nums text-ink-dim">
        {shortDateUtc(pkg.expires_at)}
      </span>
    </Link>
  );
}

function shortDate(date: Date, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "2-digit" }),
  }).format(date);
}

function shortDateUtc(yyyyMmDd: string, now: Date = new Date()): string {
  const [y, m, d] = yyyyMmDd.split("-").map((n) => parseInt(n, 10));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    ...(y === now.getFullYear() ? {} : { year: "2-digit" }),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
