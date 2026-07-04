/** Typed config objects for the commodity margin engine (port of margin.yaml). */

/** Latest index price per symbol, USD per metric tonne. */
export type Prices = Record<string, number>;

export interface ProductSpec {
  description?: string;
  /** Metal content, fraction of mass (e.g. nickel: 0.20). */
  assay: Record<string, number>;
  /** Percent of index price paid by the offtaker (e.g. nickel: 0.70). */
  payables: Record<string, number>;
}

export interface GradeMultiplierSpec {
  type: "grade_multiplier";
  description?: string;
  metals: string[];
  grade_multiplier: number;
}

export interface DiscountProfitShareSpec {
  type: "discount_profit_share";
  description?: string;
  metals: string[];
  floor_discount: number;
  profit_share: {
    metal: string;
    threshold_usd_per_mt: number;
    share: number;
  };
}

export interface CollarSpec {
  type: "collar";
  description?: string;
  metal: string;
  floor_usd_per_mt: number;
  ceiling_usd_per_mt: number;
}

export interface AssayPayablesSpec {
  type: "assay_payables";
  description?: string;
  assay: Record<string, number>;
  payables: Record<string, number>;
}

export type ContractSpec =
  | GradeMultiplierSpec
  | DiscountProfitShareSpec
  | CollarSpec
  | AssayPayablesSpec;

export interface MarginConfig {
  products: Record<string, ProductSpec>;
  /** Index symbol per metal (must match symbols in the price map). */
  indices: Record<string, string>;
  /** All-in processing cost per MT processed. */
  cost_per_mt: Record<string, number>;
  /** Current saleable inventory in dry MT. */
  inventory_mt?: Record<string, number>;
  sensitivity_shocks?: number[];
  contracts?: Record<string, ContractSpec>;
}

export interface ProductEconomics {
  product: string;
  revenue_per_mt: number;
  cost_per_mt: number;
  margin_per_mt: number;
  metal_contributions: Record<string, number>;
  inventory_mt: number;
  inventory_value: number;
  inventory_margin: number;
}

export interface ContractResult {
  name: string;
  type: string;
  description: string;
  outputs: Record<string, number>;
  flags: Record<string, boolean>;
}

/** One sensitivity row: scenario label, base margin, and one column per shock. */
export type SensitivityRow = { scenario: string; base: number } & {
  [shockLabel: string]: number | string;
};
