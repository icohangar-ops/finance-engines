/**
 * @cubiczan/finance-engines — deterministic finance engines for AI agents.
 *
 * Three pure, offline engines usable directly as a library (this module) or
 * over MCP (bin: finance-engines-mcp):
 *   - margin:   commodity-linked product economics, price sensitivity,
 *               breakeven, and contract structure evaluation
 *   - covenant: trial-balance parsing, covenant metrics, evaluation, and
 *               compliance certificate rendering
 *   - audit:    vendor-invoice anomaly rules and invoice-number normalization
 *
 * Copyright (c) 2026 Shyam Desigan (Cubiczan). All rights reserved.
 * Commercial license required — see LICENSE.md.
 */

// Margin engine
export type {
  AssayPayablesSpec,
  CollarSpec,
  ContractResult,
  ContractSpec,
  DiscountProfitShareSpec,
  GradeMultiplierSpec,
  MarginConfig,
  Prices,
  ProductEconomics,
  ProductSpec,
  SensitivityRow,
} from "./margin/types.js";
export {
  breakevenPrices,
  parsePricesCsv,
  productEconomics,
  sensitivity,
} from "./margin/engine.js";
export { evaluateAllContracts, evaluateContract } from "./margin/contracts.js";
export {
  defaultMarginConfig,
  SAMPLE_PRICES_CSV,
  samplePrices,
} from "./margin/defaults.js";

// Covenant engine
export type {
  CovenantConfig,
  CovenantMetrics,
  CovenantResult,
  CovenantSpec,
  TrialBalance,
  TrialBalanceRecord,
  TrialBalanceSection,
  XeroTrialBalanceReport,
} from "./covenant/engine.js";
export {
  allAccounts,
  certificateMarkdown,
  computeMetrics,
  evaluateCovenants,
  parseXeroTrialBalance,
  trialBalanceFromRecords,
} from "./covenant/engine.js";
export { defaultCovenantConfig } from "./covenant/defaults.js";

// Invoice audit engine
export type {
  AuditConfig,
  Finding,
  InvoiceRow,
  ItemRow,
  Severity,
} from "./audit/rules.js";
export {
  amountOutliers,
  DEFAULT_AUDIT_CONFIG,
  duplicateNumbers,
  entryLag,
  inconsistentTax,
  negativeAdjustments,
  newChargeTypes,
  normalizeInvoiceNumber,
  overdueUnpaid,
  rateChanges,
  runAllAuditRules,
} from "./audit/rules.js";
