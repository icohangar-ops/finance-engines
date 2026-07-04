/**
 * Config-driven contract pricing structures.
 *
 * Real offtake and feedstock agreements are rarely plain assay x payable: they
 * carry grade multipliers, structural discounts with profit-share triggers,
 * floor/ceiling collars, and composite payables. Each structure here is a pure
 * function of (spec, prices); contracts are defined in config, not code.
 *
 * Supported types:
 *   grade_multiplier       payable = index x multiplier per metal (e.g. black
 *                          mass sold at 85% of contained Ni/Co value)
 *   discount_profit_share  buyer takes a structural discount to spot; above a
 *                          trigger price on one metal, a share of the
 *                          incremental value flows back to the seller
 *   collar                 effective price clamped between floor and ceiling
 *   assay_payables         sum of assay x payable% x index across metals (per MT)
 *
 * Faithful TypeScript port of marginengine/contracts.py.
 */

import { round2 } from "../internal/pyformat.js";
import type {
  ContractResult,
  ContractSpec,
  MarginConfig,
  Prices,
} from "./types.js";

function price(metal: string, prices: Prices, indices: Record<string, string>): number {
  return prices[indices[metal] ?? ""] ?? 0.0;
}

export function evaluateContract(
  name: string,
  spec: ContractSpec,
  prices: Prices,
  indices: Record<string, string>,
): ContractResult {
  const ctype = spec.type;
  const desc = spec.description ?? "";

  if (ctype === "grade_multiplier") {
    const gm = Number(spec.grade_multiplier);
    const outputs: Record<string, number> = {};
    let total = 0.0;
    for (const metal of spec.metals) {
      const payable = price(metal, prices, indices) * gm;
      outputs[`${metal}_payable_usd_per_mt`] = round2(payable);
      total += payable;
    }
    outputs["total_value_per_mt"] = round2(total);
    outputs["grade_multiplier"] = gm;
    return { name, type: ctype, description: desc, outputs, flags: {} };
  }

  if (ctype === "discount_profit_share") {
    const discount = Number(spec.floor_discount);
    const ps = spec.profit_share;
    const triggerMetal = ps.metal;
    const threshold = Number(ps.threshold_usd_per_mt);
    const share = Number(ps.share);
    const outputs: Record<string, number> = {};
    for (const metal of spec.metals) {
      outputs[`floor_${metal}_usd_per_mt`] = round2(
        price(metal, prices, indices) * (1 - discount),
      );
    }
    const triggerPrice = price(triggerMetal, prices, indices);
    const incremental = Math.max(0.0, triggerPrice - threshold);
    const shareAmount = incremental * share;
    outputs["profit_share_amount"] = round2(shareAmount);
    outputs[`realized_${triggerMetal}_usd_per_mt`] = round2(
      outputs[`floor_${triggerMetal}_usd_per_mt`] - shareAmount,
    );
    return {
      name,
      type: ctype,
      description: desc,
      outputs,
      flags: { profit_share_triggered: triggerPrice > threshold },
    };
  }

  if (ctype === "collar") {
    const metal = spec.metal;
    const floor = Number(spec.floor_usd_per_mt);
    const ceiling = Number(spec.ceiling_usd_per_mt);
    const spot = price(metal, prices, indices);
    const effective = Math.min(Math.max(spot, floor), ceiling);
    return {
      name,
      type: ctype,
      description: desc,
      outputs: {
        spot_usd_per_mt: round2(spot),
        effective_usd_per_mt: round2(effective),
        floor_usd_per_mt: floor,
        ceiling_usd_per_mt: ceiling,
      },
      flags: {
        floor_binding: spot < floor,
        ceiling_binding: spot > ceiling,
      },
    };
  }

  if (ctype === "assay_payables") {
    let total = 0.0;
    const outputs: Record<string, number> = {};
    for (const [metal, assay] of Object.entries(spec.assay)) {
      const payable = Number(spec.payables[metal] ?? 0.0);
      const value = Number(assay) * payable * price(metal, prices, indices);
      outputs[`${metal}_value_usd_per_mt`] = round2(value);
      total += value;
    }
    outputs["total_value_per_mt"] = round2(total);
    return { name, type: ctype, description: desc, outputs, flags: {} };
  }

  throw new Error(
    `Unknown contract type '${(spec as { type: string }).type}' for contract '${name}'`,
  );
}

/** Evaluate every contract defined in the config at the supplied prices. */
export function evaluateAllContracts(
  cfg: MarginConfig,
  prices: Prices,
): ContractResult[] {
  const indices = cfg.indices;
  return Object.entries(cfg.contracts ?? {}).map(([name, spec]) =>
    evaluateContract(name, spec, prices, indices),
  );
}
