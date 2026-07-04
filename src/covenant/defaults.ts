/**
 * Default covenant config. Mirrors the donor engine's config/covenants.yaml
 * verbatim (typical USDA B&I / term-loan covenants) so the MCP tools work out
 * of the box when no config is supplied.
 */

import type { CovenantConfig } from "./engine.js";

export const defaultCovenantConfig: CovenantConfig = {
  annual_debt_service: 1200000,
  covenants: [
    {
      name: "Debt Service Coverage Ratio",
      metric: "dscr",
      operator: ">=",
      threshold: 1.25,
      basis: "EBITDA / annual debt service",
    },
    {
      name: "Current Ratio",
      metric: "current_ratio",
      operator: ">=",
      threshold: 1.0,
      basis: "Current assets / current liabilities",
    },
    {
      name: "Debt to Tangible Net Worth",
      metric: "debt_to_net_worth",
      operator: "<=",
      threshold: 3.0,
      basis: "Total debt / equity",
    },
    {
      name: "Minimum Liquidity",
      metric: "cash",
      operator: ">=",
      threshold: 500000,
      basis: "Cash and bank balances",
    },
  ],
  account_map: {
    cash: ["cash", "bank", "checking", "savings", "money market"],
    current_assets: [
      "cash",
      "bank",
      "checking",
      "savings",
      "money market",
      "receivable",
      "inventory",
      "prepaid",
      "deposit",
    ],
    current_liabilities: [
      "payable",
      "accrued",
      "accrual",
      "credit card",
      "current portion",
      "payroll liab",
      "sales tax",
    ],
    total_debt: [
      "loan",
      "note payable",
      "notes payable",
      "term debt",
      "current portion",
      "equipment financing",
    ],
    equity: ["equity", "capital", "retained", "common stock", "contribution"],
    ebitda_addbacks: ["depreciation", "amortization", "interest expense"],
  },
};
