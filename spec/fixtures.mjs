/**
 * Shared fixtures for the cross-language parity suite.
 *
 * Kept in one place so the vector generator and any future TS-side test import
 * the identical inputs. Values are deliberately chosen to include the exact-tie
 * and boundary cases where JS and Python rounding diverge — see
 * ../src/internal/pyformat.ts.
 */

/** Margin config: two products, three metals, tie-prone sensitivity shocks. */
export const MARGIN_CONFIG = {
  indices: { Ni: "LME-NI", Co: "LME-CO", Li: "FM-LI" },
  products: {
    "black-mass": {
      assay: { Ni: 0.22, Co: 0.05, Li: 0.035 },
      payables: { Ni: 0.7, Co: 0.7, Li: 0.4 },
    },
    "ni-sulphate": {
      assay: { Ni: 0.225 },
      payables: { Ni: 0.85 },
    },
  },
  cost_per_mt: { "black-mass": 1200.0, "ni-sulphate": 4100.5 },
  inventory_mt: { "black-mass": 480.0, "ni-sulphate": 12.5 },
  // 0.045 and 0.005 land on exactly 4.5 and 0.5 after x100, which is where
  // Python's half-even and JS's half-up rounding part company.
  sensitivity_shocks: [-0.25, -0.045, -0.005, 0.005, 0.045, 0.125, 0.25],
};

export const PRICES = {
  "LME-NI": 16250.75,
  "LME-CO": 33400.0,
  "FM-LI": 14875.125,
};

export const PRICES_CSV = [
  "date,symbol,usd_per_tonne",
  "2026-01-02,LME-NI,15900.5",
  "2026-03-14,LME-NI,16250.75",
  "2026-02-01,LME-CO,33400",
  "2026-03-14,FM-LI,14875.125",
  // Out-of-order line: the later date must win regardless of row order.
  "2026-01-15,FM-LI,13000",
].join("\n");

/** One contract of each supported type. */
export const CONTRACTS = {
  "bm-offtake": {
    type: "grade_multiplier",
    description: "Black mass at 85% of contained value",
    metals: ["Ni", "Co"],
    grade_multiplier: 0.85,
  },
  "bm-discount": {
    type: "discount_profit_share",
    description: "12.5% discount with Ni profit share above 16,000",
    metals: ["Ni", "Co"],
    floor_discount: 0.125,
    profit_share: { metal: "Ni", threshold_usd_per_mt: 16000, share: 0.35 },
  },
  // Collar takes `metal` (singular), unlike the other types which take `metals`.
  "ni-collar": {
    type: "collar",
    description: "Ni collared 15,000-16,000 (ceiling binding at spot 16,250.75)",
    metal: "Ni",
    floor_usd_per_mt: 15000,
    ceiling_usd_per_mt: 16000,
  },
  // Floor-binding case, so both collar branches are covered.
  "li-collar": {
    type: "collar",
    description: "Li collared 20,000-30,000 (floor binding at spot 14,875.125)",
    metal: "Li",
    floor_usd_per_mt: 20000,
    ceiling_usd_per_mt: 30000,
  },
  "bm-assay": {
    type: "assay_payables",
    description: "Straight assay x payable",
    metals: ["Ni", "Co", "Li"],
    assay: { Ni: 0.22, Co: 0.05, Li: 0.035 },
    payables: { Ni: 0.7, Co: 0.7, Li: 0.4 },
  },
};

/** Trial balance with a Unicode account name and a tie-prone balance. */
export const TRIAL_BALANCE = {
  revenue: { "Sales - Recycling": 4_500_000.0, "Sales - Café Services": 125_000.125 },
  expenses: {
    "Cost of Sales": 2_800_000.0,
    "Depreciation": 340_000.0,
    "Amortisation": 60_000.0,
    "Interest Expense": 180_000.0,
    "Wages": 620_000.005,
  },
  assets: {
    "Cash at Bank": 890_000.0,
    "Accounts Receivable": 1_240_000.0,
    "Inventory": 760_000.0,
    "Plant & Equipment": 5_100_000.0,
  },
  liabilities: {
    "Accounts Payable": 980_000.0,
    "Current Portion of Term Loan": 400_000.0,
    "Term Loan": 3_600_000.0,
  },
  equity: { "Share Capital": 2_000_000.0, "Retained Earnings": 450_000.0 },
};

export const COVENANT_CONFIG = {
  annual_debt_service: 620_000.0,
  covenants: [
    { name: "Minimum DSCR", metric: "dscr", operator: ">=", threshold: 1.25, basis: "EBITDA / annual debt service" },
    { name: "Max Debt to Net Worth", metric: "debt_to_net_worth", operator: "<=", threshold: 2.0, basis: "Total debt / equity" },
    { name: "Minimum Current Ratio", metric: "current_ratio", operator: ">=", threshold: 1.1, basis: "Current assets / current liabilities" },
    { name: "Minimum EBITDA", metric: "ebitda", operator: ">=", threshold: 1_000_000.0, basis: "Net income + addbacks" },
  ],
  account_map: {
    ebitda_addbacks: ["depreciation", "amortisation", "interest"],
    cash: ["cash"],
    current_assets: ["cash", "receivable", "inventory"],
    current_liabilities: ["payable", "current portion"],
    total_debt: ["term loan", "current portion"],
    equity: ["share capital", "retained earnings"],
  },
};

/**
 * Trial balance driving equity <= 0, so debt_to_net_worth must be Infinity.
 * JSON cannot represent Infinity, so the parity protocol encodes non-finite
 * numbers as strings — a real interop hazard worth pinning.
 */
export const TRIAL_BALANCE_INSOLVENT = {
  revenue: { Sales: 100_000.0 },
  expenses: { "Cost of Sales": 900_000.0 },
  assets: { "Cash at Bank": 10_000.0 },
  liabilities: { "Term Loan": 2_000_000.0 },
  equity: { "Share Capital": 50_000.0 },
};

export const TRIAL_BALANCE_RECORDS = [
  { account: "Sales - Recycling", section: "revenue", credit: 4_500_000.0 },
  { account: "Cost of Sales", section: "expenses", debit: 2_800_000.0 },
  { account: "Cash at Bank", section: "assets", debit: 890_000.0 },
  { account: "Accounts Payable", section: "liabilities", credit: 980_000.0 },
  { account: "Share Capital", section: "equity", credit: 2_000_000.0 },
  // Same account twice: both implementations must accumulate, not overwrite.
  { account: "Cash at Bank", section: "assets", debit: 10_000.0 },
];

/** Invoices exercising every header-level rule. */
export const INVOICES = [
  // Duplicate pair: same supplier, numbers that normalize together.
  { id: 1, invoice_number: "INV-1001", supplier_id: 10, supplier_name: "Acme Metals", issue_date: "2026-01-05", create_date: "2026-01-06", required_date: "2026-01-20", sum: 12_500.0, net_sum: 12_500.0, sum_paid: 12_500.0, status: 3, currency: "USD" },
  { id: 2, invoice_number: "#inv1001", supplier_id: 10, supplier_name: "Acme Metals", issue_date: "2026-01-05", create_date: "2026-01-07", required_date: "2026-01-20", sum: 12_500.0, net_sum: 12_500.0, sum_paid: 0.0, status: 1, currency: "USD" },
  // Entry lag: created 40 days after issue.
  { id: 3, invoice_number: "INV-1002", supplier_id: 10, supplier_name: "Acme Metals", issue_date: "2026-01-01", create_date: "2026-02-10", required_date: "2026-02-01", sum: 4_000.0, net_sum: 4_000.0, sum_paid: 4_000.0, status: 3, currency: "USD" },
  // Overdue and unpaid relative to the injected `today`. status must be 2
  // (approved) or 4 (partly paid) for the rule to consider it at all.
  { id: 4, invoice_number: "INV-1003", supplier_id: 20, supplier_name: "Borax Ltd", issue_date: "2026-01-10", create_date: "2026-01-11", required_date: "2026-02-01", sum: 8_800.0, net_sum: 8_800.0, sum_paid: 0.0, status: 2, currency: "USD" },
  // Partly paid and overdue by more than 60 days -> severity "high".
  { id: 10, invoice_number: "INV-1004", supplier_id: 20, supplier_name: "Borax Ltd", issue_date: "2025-11-01", create_date: "2025-11-02", required_date: "2025-11-15", sum: 5_000.0, net_sum: 5_000.0, sum_paid: 1_500.0, status: 4, currency: "USD" },
  // Baseline invoices so the outlier rule has >= min_invoices_for_baseline.
  { id: 5, invoice_number: "INV-2001", supplier_id: 30, supplier_name: "Cobalt Co", issue_date: "2026-01-02", create_date: "2026-01-03", required_date: "2026-01-20", sum: 1_000.0, net_sum: 1_000.0, sum_paid: 1_000.0, status: 3, currency: "USD" },
  { id: 6, invoice_number: "INV-2002", supplier_id: 30, supplier_name: "Cobalt Co", issue_date: "2026-01-09", create_date: "2026-01-10", required_date: "2026-01-27", sum: 1_100.0, net_sum: 1_100.0, sum_paid: 1_100.0, status: 3, currency: "USD" },
  { id: 7, invoice_number: "INV-2003", supplier_id: 30, supplier_name: "Cobalt Co", issue_date: "2026-01-16", create_date: "2026-01-17", required_date: "2026-02-03", sum: 900.0, net_sum: 900.0, sum_paid: 900.0, status: 3, currency: "USD" },
  // The outlier: ~30x the baseline mean.
  { id: 8, invoice_number: "INV-2004", supplier_id: 30, supplier_name: "Cobalt Co", issue_date: "2026-01-23", create_date: "2026-01-24", required_date: "2026-02-10", sum: 30_000.0, net_sum: 30_000.0, sum_paid: 0.0, status: 1, currency: "USD" },
  // Null-ish fields: both sides must treat missing as absent, not zero-crash.
  { id: 9, invoice_number: "INV-3001", supplier_id: null, supplier_name: "Unknown Vendor", issue_date: "2026-02-01", create_date: "2026-02-01", required_date: null, sum: 500.0, net_sum: null, sum_paid: null, status: null, currency: null },
];

/** Line items exercising every item-level rule. */
export const ITEMS = [
  // Rate change on the same item name across invoices: 100 -> 120 (+20%).
  { invoice_id: 5, name: "Freight", price: 100.0, quantity: 2, line_sum: 200.0, tax_percent: 20.0 },
  { invoice_id: 6, name: "freight", price: 100.0, quantity: 2, line_sum: 200.0, tax_percent: 20.0 },
  { invoice_id: 7, name: "FREIGHT", price: 120.0, quantity: 2, line_sum: 240.0, tax_percent: 20.0 },
  // Inconsistent tax on the same item name.
  { invoice_id: 8, name: "Freight", price: 120.0, quantity: 1, line_sum: 120.0, tax_percent: 5.0 },
  // A brand-new charge type appearing only on the latest invoice.
  { invoice_id: 8, name: "Expedite Surcharge", price: 750.0, quantity: 1, line_sum: 750.0, tax_percent: 20.0 },
  // Negative adjustment / credit line.
  { invoice_id: 8, name: "Volume Rebate", price: -1_250.0, quantity: 1, line_sum: -1_250.0, tax_percent: 0.0 },
  // Tie-prone rate change: exercises round2/fmtG inside the detail string.
  { invoice_id: 1, name: "Handling", price: 2.675, quantity: 10, line_sum: 26.75, tax_percent: 20.0 },
  { invoice_id: 2, name: "handling", price: 2.8, quantity: 10, line_sum: 28.0, tax_percent: 20.0 },
  // inconsistent_tax keys off taxed-vs-untaxed (truthiness of tax_percent), not
  // differing rates: "Pallets" is taxed for supplier 20 on one invoice and
  // untaxed on another, which is the shape the rule actually looks for.
  { invoice_id: 4, name: "Pallets", price: 45.0, quantity: 4, line_sum: 180.0, tax_percent: 20.0 },
  { invoice_id: 10, name: "pallets", price: 45.0, quantity: 4, line_sum: 180.0, tax_percent: 0.0 },
];

/** Injected so overdue checks are reproducible rather than clock-dependent. */
export const AUDIT_CONFIG = {
  entry_lag_days: 14,
  overdue_days: 10,
  amount_outlier_multiple: 3.0,
  rate_change_pct: 5.0,
  min_invoices_for_baseline: 3,
  today: "2026-03-01",
};

/** Inputs for the pyformat primitives, heavy on exact ties. */
export const PYFORMAT_CASES = [
  0, -0, 0.1, 0.25, -0.25, 0.005, -0.005, 0.004, -0.004, 0.045, -0.045,
  0.125, -0.125, 0.135, 0.5, -0.5, 2.5, -2.5, 1.005, 1.115, 2.675, -2.675,
  1234.565, 1e-7, 16250.75, 33400, 14875.125, 1000000.005,
];
