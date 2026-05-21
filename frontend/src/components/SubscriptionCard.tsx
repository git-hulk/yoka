import { Link } from "react-router-dom";

import type { Subscription } from "../lib/types";
import {
  filledFraction,
  formatPrice,
  paceColor,
  statusLabel,
  tickFraction,
  usageRatioLabel,
} from "../lib/pace";
import StatusPill from "./StatusPill";
import TrackBand from "./TrackBand";

interface Props {
  sub: Subscription;
}

export default function SubscriptionCard({ sub }: Props) {
  const color = paceColor(sub);

  return (
    <Link
      to={`/subscriptions/${sub.id}`}
      className="group relative -mx-4 grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] items-center gap-5 px-4 py-4 transition duration-300 ease-out hover:bg-accent-soft focus:outline-none sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="serif truncate text-base leading-tight text-ink decoration-accent/60 underline-offset-4 group-hover:underline">
          {sub.name}
        </h2>
        <span
          aria-hidden="true"
          className="-translate-x-1 text-base leading-none text-accent opacity-0 transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100"
        >
          →
        </span>
      </div>

      <div className="space-y-2 pb-0.5">
        <div className="num text-[11px] tabular-nums tracking-micro text-ink-faint">
          {usageRatioLabel(sub)}
        </div>
        <TrackBand
          color={color}
          filled={filledFraction(sub)}
          tick={tickFraction(sub)}
          size="lg"
        />
      </div>

      <StatusPill status={sub.status} color={color} label={statusLabel(sub.status)} />

      <span className="num hidden text-right text-sm tabular-nums text-ink-dim sm:inline">
        {formatPrice(sub.price_cents, sub.currency) ?? ""}
      </span>

      <span className="num text-right text-sm tabular-nums text-ink-dim">
        {shortDateUtc(sub.expires_at)}
      </span>
    </Link>
  );
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
