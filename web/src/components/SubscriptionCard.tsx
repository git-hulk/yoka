import { Link } from "react-router-dom";

import { subscriptionColor } from "../lib/colors";
import type { Subscription } from "../lib/types";
import {
  filledFraction,
  formatPrice,
  paceColor,
  statusLabel,
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
      className="group grid grid-cols-[minmax(0,1.4fr)_minmax(110px,1.3fr)_5.5rem_5rem] items-center gap-5 px-4 py-3 transition hover:bg-subtle focus-visible:bg-subtle sm:grid-cols-[minmax(0,1.4fr)_minmax(140px,1.4fr)_5.5rem_5rem_5rem]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: subscriptionColor(sub.id) }}
        />
        <h2 className="truncate text-sm font-medium text-ink group-hover:text-accent">
          {sub.name}
        </h2>
      </div>

      {/* Ratio and bar share one line so the cell centers on the same
          optical line as the other columns; the fixed-width label keeps
          bars edge-aligned across rows. */}
      <div className="flex items-center gap-2.5">
        <span className="num w-11 shrink-0 text-2xs tabular-nums text-ink-faint">
          {usageRatioLabel(sub)}
        </span>
        <div className="min-w-0 flex-1">
          <TrackBand
            color={color}
            filled={filledFraction(sub)}
            size="md"
          />
        </div>
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
