/**
 * Parity adapter for the TypeScript engines in this package.
 *
 * Because the vectors are generated from these same engines, this adapter must
 * always pass — it is the control. If it ever fails, the vectors are stale
 * (re-run `node spec/generate_vectors.mjs`) rather than the engines being wrong.
 *
 *     python3 spec/run_parity.py --adapter-cmd "node spec/adapters/ts_adapter.mjs"
 */
import { createInterface } from "node:readline";

import {
  amountOutliers,
  breakevenPrices,
  computeMetrics,
  duplicateNumbers,
  entryLag,
  evaluateContract,
  evaluateCovenants,
  inconsistentTax,
  negativeAdjustments,
  newChargeTypes,
  normalizeInvoiceNumber,
  overdueUnpaid,
  parsePricesCsv,
  productEconomics,
  rateChanges,
  runAllAuditRules,
  sensitivity,
  trialBalanceFromRecords,
} from "../../dist/index.js";
import { fmtFixed, fmtG, fmtSignedPct, round2 } from "../../dist/internal/pyformat.js";

/** JSON cannot carry -0, so the runner flags it and we rebuild it here. */
function num(args) {
  return args.negative_zero ? -0 : args.n;
}

/**
 * Turn the wire encoding of non-finite numbers back into real numbers.
 *
 * Required, not optional: `covenant.evaluate` is handed a metrics object whose
 * debt_to_net_worth may be "Infinity". JS would silently coerce that string in a
 * `>=` comparison and appear to work, while a Python adapter raises a TypeError —
 * so relying on coercion would make the two sides disagree for a reason that has
 * nothing to do with the engines.
 */
function decode(value) {
  if (typeof value === "string") {
    if (value === "Infinity") return Infinity;
    if (value === "-Infinity") return -Infinity;
    if (value === "NaN") return NaN;
    return value;
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

/** Encode non-finite numbers as strings, matching the vector encoding. */
function encode(value) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return value;
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

const OPS = {
  "pyformat.fixed": (a) => fmtFixed(num(a), a.decimals, a.grouping ?? false, a.force_sign ?? false),
  "pyformat.signed_pct": (a) => fmtSignedPct(num(a)),
  "pyformat.round2": (a) => round2(num(a)),
  "pyformat.g": (a) => fmtG(num(a)),

  "margin.parse_prices_csv": (a) => parsePricesCsv(a.csv),
  "margin.product_economics": (a) => productEconomics(a.cfg, a.prices),
  "margin.sensitivity": (a) => sensitivity(a.cfg, a.prices, a.product),
  "margin.breakeven": (a) => breakevenPrices(a.cfg, a.prices, a.product),
  "margin.contract": (a) => evaluateContract(a.name, a.spec, a.prices, a.indices),

  "covenant.metrics": (a) => computeMetrics(a.tb, a.cfg),
  "covenant.evaluate": (a) => evaluateCovenants(a.metrics, a.cfg),
  "covenant.trial_balance_from_records": (a) => trialBalanceFromRecords(a.records),

  "audit.normalize_number": (a) => normalizeInvoiceNumber(a.num),
  "audit.duplicate_numbers": (a) => duplicateNumbers(a.invoices),
  "audit.entry_lag": (a) => entryLag(a.invoices, a.cfg),
  "audit.overdue_unpaid": (a) => overdueUnpaid(a.invoices, a.cfg),
  "audit.amount_outliers": (a) => amountOutliers(a.invoices, a.cfg),
  "audit.rate_changes": (a) => rateChanges(a.invoices, a.items, a.cfg),
  "audit.new_charge_types": (a) => newChargeTypes(a.invoices, a.items),
  "audit.negative_adjustments": (a) => negativeAdjustments(a.invoices, a.items),
  "audit.inconsistent_tax": (a) => inconsistentTax(a.invoices, a.items),
  "audit.run_all": (a) => runAllAuditRules(a.invoices, a.items, a.cfg),
};

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let out;
  try {
    const { op, args } = JSON.parse(line);
    const fn = OPS[op];
    if (!fn) {
      out = { ok: false, error: "unsupported op" };
    } else {
      out = { ok: true, result: encode(fn(decode(args ?? {}))) };
    }
  } catch (err) {
    out = { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
});
