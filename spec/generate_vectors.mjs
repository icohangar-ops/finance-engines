/**
 * Generate the cross-language parity vectors from the TypeScript engines.
 *
 *     node spec/generate_vectors.mjs
 *
 * TypeScript is the designated authority (dependency-free, and already the MCP
 * surface), so every expected value here is computed — none are hand-written and
 * the vectors cannot drift from the implementation. Re-run after any intentional
 * engine change and review the diff.
 *
 * Non-finite numbers are encoded as the strings "Infinity" / "-Infinity" / "NaN".
 * JSON has no representation for them, and `covenant.metrics` genuinely returns
 * Infinity for debt_to_net_worth when equity <= 0, so the encoding is part of the
 * protocol rather than an afterthought.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
} from "../dist/index.js";
import { fmtFixed, fmtG, fmtSignedPct, round2 } from "../dist/internal/pyformat.js";
import {
  AUDIT_CONFIG,
  CONTRACTS,
  COVENANT_CONFIG,
  INVOICES,
  ITEMS,
  MARGIN_CONFIG,
  PRICES,
  PRICES_CSV,
  PYFORMAT_CASES,
  TRIAL_BALANCE,
  TRIAL_BALANCE_INSOLVENT,
  TRIAL_BALANCE_RECORDS,
} from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "golden-vectors");

/** Encode non-finite numbers as strings so they survive JSON. */
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

function write(name, payload) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(encode(payload), null, 2) + "\n", "utf8");
  console.log(`wrote spec/golden-vectors/${name}`);
}

// ---------------------------------------------------------------- pyformat

write("pyformat.json", {
  spec: "Python format-string equivalence (src/internal/pyformat.ts)",
  note:
    "Python rounds half-to-even on the exact double; JS Math.round/toFixed round " +
    "half-away-from-zero. These vectors pin the tie cases. fmtSignedPct output is " +
    "used as an object key in sensitivity(), so a mismatch is not cosmetic.",
  cases: PYFORMAT_CASES.map((n) => ({
    input: n,
    // -0 does not survive JSON, so flag it explicitly for the adapters.
    negative_zero: Object.is(n, -0) || undefined,
    fixed_2: fmtFixed(n, 2),
    fixed_2_grouped: fmtFixed(n, 2, true),
    fixed_0_signed: fmtFixed(n, 0, false, true),
    signed_pct: fmtSignedPct(n),
    round_2: round2(n),
    g: fmtG(n),
  })),
});

// ------------------------------------------------------------------ margin

write("margin.json", {
  spec: "Commodity margin engine (marginengine/engine.py <-> src/margin/)",
  config: MARGIN_CONFIG,
  prices: PRICES,
  prices_csv: PRICES_CSV,
  parse_prices_csv: parsePricesCsv(PRICES_CSV),
  product_economics: productEconomics(MARGIN_CONFIG, PRICES),
  sensitivity: Object.fromEntries(
    Object.keys(MARGIN_CONFIG.products).map((p) => [p, sensitivity(MARGIN_CONFIG, PRICES, p)]),
  ),
  breakeven: Object.fromEntries(
    Object.keys(MARGIN_CONFIG.products).map((p) => [p, breakevenPrices(MARGIN_CONFIG, PRICES, p)]),
  ),
  contracts: Object.fromEntries(
    Object.entries(CONTRACTS).map(([name, spec]) => [
      name,
      { spec, result: evaluateContract(name, spec, PRICES, MARGIN_CONFIG.indices) },
    ]),
  ),
});

// ---------------------------------------------------------------- covenant

const metrics = computeMetrics(TRIAL_BALANCE, COVENANT_CONFIG);
const insolventMetrics = computeMetrics(TRIAL_BALANCE_INSOLVENT, COVENANT_CONFIG);

write("covenant.json", {
  spec: "Covenant compliance engine (covtracker/engine.py <-> src/covenant/)",
  note:
    "debt_to_net_worth is Infinity when equity <= 0, encoded as the string " +
    '"Infinity" because JSON cannot represent it.',
  config: COVENANT_CONFIG,
  trial_balance: TRIAL_BALANCE,
  metrics,
  evaluate: evaluateCovenants(metrics, COVENANT_CONFIG),
  insolvent: {
    trial_balance: TRIAL_BALANCE_INSOLVENT,
    metrics: insolventMetrics,
    evaluate: evaluateCovenants(insolventMetrics, COVENANT_CONFIG),
  },
  trial_balance_from_records: {
    records: TRIAL_BALANCE_RECORDS,
    result: trialBalanceFromRecords(TRIAL_BALANCE_RECORDS),
  },
});

// ------------------------------------------------------------------- audit

write("audit.json", {
  spec: "Invoice audit rules (auditengine/rules.py <-> src/audit/rules.ts)",
  note:
    "`today` is injected via config so overdue checks are reproducible. Findings " +
    "are compared as an order-insensitive multiset: neither engine promises an " +
    "emission order, so requiring one would make the suite brittle for no gain.",
  config: AUDIT_CONFIG,
  invoices: INVOICES,
  items: ITEMS,
  normalize_number: Object.fromEntries(
    ["INV-1001", "#inv1001", "NV1001", "IN1001", "inv 10/01", "", "1001", "INVOICE-9"].map((n) => [
      n,
      normalizeInvoiceNumber(n),
    ]),
  ),
  rules: {
    duplicate_numbers: duplicateNumbers(INVOICES),
    entry_lag: entryLag(INVOICES, AUDIT_CONFIG),
    overdue_unpaid: overdueUnpaid(INVOICES, AUDIT_CONFIG),
    amount_outliers: amountOutliers(INVOICES, AUDIT_CONFIG),
    rate_changes: rateChanges(INVOICES, ITEMS, AUDIT_CONFIG),
    new_charge_types: newChargeTypes(INVOICES, ITEMS),
    negative_adjustments: negativeAdjustments(INVOICES, ITEMS),
    inconsistent_tax: inconsistentTax(INVOICES, ITEMS),
  },
  run_all: runAllAuditRules(INVOICES, ITEMS, AUDIT_CONFIG),
});

console.log("\nvectors generated from the TypeScript engines");
