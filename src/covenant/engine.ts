/**
 * Covenant computation from a trial balance.
 *
 * The engine is pure: it takes a parsed trial balance (account -> balance by
 * section) and the covenant config, and returns metric values plus compliance
 * status with headroom. Xero report parsing is isolated in
 * parseXeroTrialBalance; a plain array-of-records path is provided via
 * trialBalanceFromRecords.
 *
 * Faithful TypeScript port of covtracker/engine.py.
 */

import { fmtFixed } from "../internal/pyformat.js";

/**
 * Balances by section. Revenue/liability/equity balances are positive when in
 * their natural credit position.
 */
export interface TrialBalance {
  revenue: Record<string, number>;
  expenses: Record<string, number>;
  assets: Record<string, number>;
  liabilities: Record<string, number>;
  equity: Record<string, number>;
}

export type TrialBalanceSection = keyof TrialBalance;

export interface TrialBalanceRecord {
  account: string;
  section: TrialBalanceSection;
  debit?: number;
  credit?: number;
}

export interface CovenantSpec {
  name: string;
  metric: string;
  operator: ">=" | "<=";
  threshold: number;
  basis?: string;
}

export interface CovenantConfig {
  /** Scheduled P+I for the measurement year (drives DSCR). */
  annual_debt_service?: number;
  covenants: CovenantSpec[];
  /**
   * Substring patterns (case-insensitive) mapping trial-balance account names
   * to metric inputs.
   */
  account_map: {
    cash: string[];
    current_assets: string[];
    current_liabilities: string[];
    total_debt: string[];
    equity: string[];
    ebitda_addbacks: string[];
  };
}

export interface CovenantResult {
  name: string;
  metric: string;
  value: number;
  operator: string;
  threshold: number;
  compliant: boolean;
  headroom_pct: number;
  basis: string;
}

export type CovenantMetrics = Record<string, number>;

const SECTION_KEYS: TrialBalanceSection[] = [
  "revenue",
  "expenses",
  "assets",
  "liabilities",
  "equity",
];

/** All accounts across sections merged into one map (later sections win). */
export function allAccounts(tb: TrialBalance): Record<string, number> {
  return {
    ...tb.revenue,
    ...tb.expenses,
    ...tb.assets,
    ...tb.liabilities,
    ...tb.equity,
  };
}

function toFloat(v: unknown): number {
  const s = String(v ?? "").replace(/,/g, "");
  if (s === "") return 0.0;
  const n = Number(s);
  return Number.isNaN(n) ? 0.0 : n;
}

interface XeroCell {
  Value?: unknown;
}
interface XeroRow {
  RowType?: string;
  Title?: string;
  Rows?: XeroRow[];
  Cells?: XeroCell[];
}
export interface XeroTrialBalanceReport {
  Reports?: Array<{ Rows?: XeroRow[] }>;
}

/**
 * Flatten a Xero Reports/TrialBalance payload into section dicts.
 *
 * Xero TB rows carry Debit/Credit YTD cells; we net them into a single
 * balance per account (debit positive for assets/expenses, credit positive
 * for revenue/liabilities/equity).
 */
export function parseXeroTrialBalance(
  report: XeroTrialBalanceReport,
): TrialBalance {
  const sections: TrialBalance = {
    revenue: {},
    expenses: {},
    assets: {},
    liabilities: {},
    equity: {},
  };
  const rows = (report.Reports ?? [{}])[0]?.Rows ?? [];
  for (const section of rows) {
    if (section.RowType !== "Section") continue;
    const title = (section.Title ?? "").toLowerCase();
    const target = SECTION_KEYS.find((s) => title.startsWith(s.slice(0, 5)));
    if (target === undefined) continue;
    for (const row of section.Rows ?? []) {
      const cells = row.Cells ?? [];
      if (cells.length < 3) continue;
      const name = String(cells[0].Value ?? "");
      const debit = toFloat(cells[1].Value);
      const credit = toFloat(cells[2].Value);
      const balance =
        target === "assets" || target === "expenses"
          ? debit - credit
          : credit - debit;
      if (name) sections[target][name] = balance;
    }
  }
  return sections;
}

/**
 * Build a TrialBalance from plain array-of-records input
 * ({account, section, debit, credit}). Debits/credits are netted with the same
 * sign convention as parseXeroTrialBalance.
 */
export function trialBalanceFromRecords(
  records: TrialBalanceRecord[],
): TrialBalance {
  const sections: TrialBalance = {
    revenue: {},
    expenses: {},
    assets: {},
    liabilities: {},
    equity: {},
  };
  for (const rec of records) {
    if (!rec.account || !(rec.section in sections)) continue;
    const debit = toFloat(rec.debit);
    const credit = toFloat(rec.credit);
    const balance =
      rec.section === "assets" || rec.section === "expenses"
        ? debit - credit
        : credit - debit;
    sections[rec.section][rec.account] = balance;
  }
  return sections;
}

function matchSum(accounts: Record<string, number>, patterns: string[]): number {
  let total = 0.0;
  for (const [name, bal] of Object.entries(accounts)) {
    const lower = name.toLowerCase();
    if (patterns.some((p) => lower.includes(p.toLowerCase()))) total += bal;
  }
  return total;
}

/** Compute the financial metrics used by loan covenants. */
export function computeMetrics(
  tb: TrialBalance,
  cfg: CovenantConfig,
): CovenantMetrics {
  const amap = cfg.account_map;
  const sum = (m: Record<string, number>) =>
    Object.values(m).reduce((a, b) => a + b, 0);
  const revenue = sum(tb.revenue);
  const expenses = sum(tb.expenses);
  const netIncome = revenue - expenses;
  const addbacks = matchSum(tb.expenses, amap.ebitda_addbacks);
  const ebitda = netIncome + addbacks;
  const debtService = Number(cfg.annual_debt_service || 0);
  const cash = matchSum(tb.assets, amap.cash);
  const currentAssets = matchSum(tb.assets, amap.current_assets);
  const currentLiabilities = matchSum(tb.liabilities, amap.current_liabilities);
  const totalDebt = matchSum(tb.liabilities, amap.total_debt);
  const equity = matchSum(tb.equity, amap.equity) + netIncome;
  return {
    revenue,
    net_income: netIncome,
    ebitda,
    cash,
    current_ratio: currentLiabilities ? currentAssets / currentLiabilities : 0.0,
    dscr: debtService ? ebitda / debtService : 0.0,
    debt_to_net_worth: equity > 0 ? totalDebt / equity : Infinity,
    total_debt: totalDebt,
    equity,
  };
}

/** Test computed metrics against covenant thresholds with headroom. */
export function evaluateCovenants(
  metrics: CovenantMetrics,
  cfg: CovenantConfig,
): CovenantResult[] {
  const results: CovenantResult[] = [];
  for (const cov of cfg.covenants) {
    const value = metrics[cov.metric] ?? 0.0;
    const threshold = Number(cov.threshold);
    const op = cov.operator;
    const compliant = op === ">=" ? value >= threshold : value <= threshold;
    const headroom = threshold
      ? ((op === ">=" ? value - threshold : threshold - value) /
          Math.abs(threshold)) *
        100
      : 0.0;
    results.push({
      name: cov.name,
      metric: cov.metric,
      value,
      operator: op,
      threshold,
      compliant,
      headroom_pct: headroom,
      basis: cov.basis ?? "",
    });
  }
  return results;
}

/** Render a signable markdown covenant compliance certificate. */
export function certificateMarkdown(
  results: CovenantResult[],
  metrics: CovenantMetrics,
  period: string,
): string {
  const lines = [
    `# Covenant Compliance Certificate — ${period}`,
    "",
    "| Covenant | Required | Actual | Headroom | Status |",
    "|---|---|---|---|---|",
  ];
  for (const r of results) {
    const fmt = (v: number) =>
      r.metric === "cash" ? fmtFixed(v, 0, true) : fmtFixed(v, 2);
    lines.push(
      `| ${r.name} | ${r.operator} ${fmt(r.threshold)} | ${fmt(r.value)} ` +
        `| ${fmtFixed(r.headroom_pct, 0, false, true)}% | ${r.compliant ? "COMPLIANT" : "BREACH"} |`,
    );
  }
  const usd = (v: number) => "$" + fmtFixed(v, 0, true);
  lines.push(
    "",
    `Supporting metrics: EBITDA ${usd(metrics.ebitda)} · ` +
      `Net income ${usd(metrics.net_income)} · Cash ${usd(metrics.cash)} · ` +
      `Total debt ${usd(metrics.total_debt)} · Equity ${usd(metrics.equity)}`,
    "",
    "The undersigned certifies the above is computed from the books of the company " +
      "in accordance with the loan agreement.",
  );
  return lines.join("\n");
}
