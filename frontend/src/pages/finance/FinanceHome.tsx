// The Finance landing page — a year-only dashboard.
//
// Each currency that has any spend or budget for the year gets its own
// monthly trend chart. A small picker at the top filters the view to a
// single currency on demand; the default is "All". Subscriptions are
// intentionally excluded from these rollups — they live on their own page.
//
// One endpoint:  GET /finance/yearly?year=YYYY

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../../lib/api";
import MonthlyTrendChart from "../../components/MonthlyTrendChart";
import YearSwitcher, { formatYear } from "../../components/YearSwitcher";
import { formatPrice } from "../../lib/pace";
import { CURRENCIES } from "../../lib/types";
import type {
  BudgetBar as BudgetBarData,
  Currency,
  MonthlyTotal,
  YearlyLedger,
} from "../../lib/types";
import { useFetch } from "../../lib/useFetch";

type CurrencyFilter = "all" | Currency;

const FILTER_KEY = "yoka:finance:currencyFilter";

function initialFilter(): CurrencyFilter {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(FILTER_KEY);
  if (stored === "all") return "all";
  if (stored && (CURRENCIES as readonly string[]).includes(stored)) {
    return stored as Currency;
  }
  return "all";
}

export default function FinanceHome() {
  const [year,   setYear]   = useState<string>(() => formatYear(new Date()));
  const [filter, setFilter] = useState<CurrencyFilter>(initialFilter);

  const state = useFetch(() => api.getYearlyLedger(year), [year]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FILTER_KEY, filter);
  }, [filter]);

  return (
    <div className="space-y-10">
      <Heading />

      <div className="flex items-baseline justify-end gap-4">
        <CurrencyFilterPicker value={filter} onChange={setFilter} />
      </div>

      <YearSwitcher year={year} onChange={setYear} />

      {state.status === "loading" && <Skeleton />}
      {state.status === "error" && (
        <ErrorBox title="Couldn't load the year" detail={state.error.message} />
      )}
      {state.status === "ok" && <Body data={state.data} filter={filter} />}
    </div>
  );
}

function Heading() {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
      <div>
        <h1 className="serif text-base font-bold leading-none text-ink">
          Finance
        </h1>
        <p className="num mt-3 text-[11px] uppercase tracking-micro text-ink-faint">
          spend, budgets, and the trail behind them
        </p>
      </div>
      <div className="flex items-baseline gap-5">
        <Link
          to="/finance/recurring-expenses/new"
          className="text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-accent"
        >
          + recurring
        </Link>
        <Link
          to="/finance/expenses/new"
          className="inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
        >
          <span aria-hidden="true" className="text-base leading-none">＋</span>
          new expense
        </Link>
      </div>
    </div>
  );
}

function CurrencyFilterPicker({
  value, onChange,
}: {
  value:    CurrencyFilter;
  onChange: (v: CurrencyFilter) => void;
}) {
  return (
    <label className="flex items-baseline gap-2 text-[11px] uppercase tracking-micro text-ink-faint">
      showing
      <select
        aria-label="currency filter"
        value={value}
        onChange={(e) => onChange(e.target.value as CurrencyFilter)}
        className="
          cursor-pointer border-b border-hairline bg-transparent pl-1 pr-5 pb-0.5
          text-sm font-medium uppercase tracking-wider text-ink-dim
          outline-none transition hover:border-ink-faint hover:text-ink focus:border-accent
        "
      >
        <option value="all">All</option>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

function Body({
  data, filter,
}: {
  data:   YearlyLedger;
  filter: CurrencyFilter;
}) {
  if (data.currencies.length === 0) {
    return <Empty />;
  }
  const visible = filter === "all"
    ? data.currencies
    : data.currencies.filter((c) => c === filter);

  if (visible.length === 0) {
    return (
      <p className="pt-6 text-center text-sm text-ink-faint">
        No spending in {filter} this year.
      </p>
    );
  }

  return (
    <div className="space-y-12">
      {visible.map((currency) => (
        <CurrencySection
          key={currency}
          currency={currency}
          bars={data.bars.filter((b) => b.currency === currency)}
          monthlyTotals={data.monthly_totals.filter((m) => m.currency === currency)}
          year={data.year}
        />
      ))}
    </div>
  );
}

function CurrencySection({
  currency, bars, monthlyTotals, year,
}: {
  currency:      Currency;
  bars:          BudgetBarData[];
  monthlyTotals: MonthlyTotal[];
  year:          string;
}) {
  const totalSpent = bars.reduce((acc, b) => acc + b.spent_cents, 0);
  const anyOver = bars.some(
    (b) => b.budget_cents !== null && b.budget_cents > 0 && b.spent_cents > b.budget_cents,
  );

  return (
    <section className="space-y-8">
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
        <h3 className="serif text-base text-ink">{currency}</h3>
        <p className="num text-sm tabular-nums text-ink-dim">
          {formatPrice(totalSpent, currency)} this year
          {anyOver && (
            <span className="ml-3 text-[11px] uppercase tracking-micro text-pace-red">
              over budget
            </span>
          )}
        </p>
      </header>
      <MonthlyTrendChart currency={currency} totals={monthlyTotals} year={year} />
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-ink/5" />
      <div className="h-6 w-1/3 animate-pulse rounded-sm bg-ink/5" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-1 w-full animate-pulse bg-ink/5" />
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="pt-6 text-center">
      <p className="serif text-base font-semibold text-ink">
        Nothing tracked this year.
      </p>
      <p className="mt-3 text-sm text-ink-dim">
        Add a one-off expense, define a recurring bill,<br className="hidden sm:inline" />
        or set a budget — anything you add will show up here.
      </p>
      <div className="mt-7 flex items-baseline justify-center gap-6">
        <Link
          to="/finance/expenses/new"
          className="inline-flex items-baseline gap-1.5 border-b border-ink pb-0.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
        >
          <span aria-hidden="true">＋</span>
          add an expense
        </Link>
        <Link
          to="/finance/recurring-expenses/new"
          className="text-[11px] uppercase tracking-micro text-ink-dim transition hover:text-accent"
        >
          add a recurring rule
        </Link>
      </div>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-y border-pace-red/40 bg-pace-red/5 px-1 py-5">
      <p className="text-sm font-semibold text-pace-red">{title}</p>
      <p className="mt-1 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
