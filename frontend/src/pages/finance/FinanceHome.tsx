// The Finance landing page — a year-only dashboard.
//
// Each currency that has any spend or budget for the year gets its own
// monthly trend chart. A small picker at the top filters the view to a
// single currency on demand; the default is "All". Subscriptions, one-off
// expenses, and recurring rules all roll into these totals — a subscription
// counts once on its purchase month.
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
    <div className="space-y-6">
      <Heading />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <YearSwitcher year={year} onChange={setYear} />
        <CurrencyFilterPicker value={filter} onChange={setFilter} />
      </div>

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
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
      <div>
        <h1 className="text-xl font-medium tracking-tight text-ink">Finance</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Spend, budgets, and the trail behind them.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/finance/recurring-expenses/new"
          className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle"
        >
          Recurring
        </Link>
        <Link
          to="/finance/expenses/new"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep"
        >
          <span aria-hidden="true" className="text-base leading-none">＋</span>
          New expense
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
    <label className="flex items-center gap-2 text-xs text-ink-dim">
      Showing
      <select
        aria-label="currency filter"
        value={value}
        onChange={(e) => onChange(e.target.value as CurrencyFilter)}
        className="h-8 cursor-pointer rounded-md border border-hairline bg-white px-2 text-sm font-medium text-ink outline-none transition hover:border-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
        <h3 className="text-base font-medium text-ink">{currency}</h3>
        <p className="num text-sm tabular-nums text-ink-dim">
          {formatPrice(totalSpent, currency)} this year
          {anyOver && (
            <span className="ml-2 inline-flex items-center rounded-full border border-pace-red/30 bg-pace-red/10 px-2 py-0.5 text-xs font-medium text-pace-red">
              Over budget
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
    <div className="rounded-lg border border-dashed border-hairline bg-subtle/40 px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">Nothing tracked this year.</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-dim">
        Add a one-off expense, define a recurring bill, or set a budget. Anything
        you add will show up here.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Link
          to="/finance/expenses/new"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-deep"
        >
          <span aria-hidden="true">＋</span>
          Add an expense
        </Link>
        <Link
          to="/finance/recurring-expenses/new"
          className="inline-flex h-8 items-center rounded-md border border-hairline bg-white px-3 text-sm font-medium text-ink transition hover:bg-subtle"
        >
          Add a recurring rule
        </Link>
      </div>
    </div>
  );
}

function ErrorBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-pace-red/40 bg-pace-red/5 px-4 py-3">
      <p className="text-sm font-medium text-pace-red">{title}</p>
      <p className="mt-0.5 text-xs text-ink-dim">{detail}</p>
    </div>
  );
}
