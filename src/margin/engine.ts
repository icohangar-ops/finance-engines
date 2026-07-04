/**
 * Commodity-linked margin model for battery-recycling products.
 *
 * Revenue per MT = sum over metals of assay% x payable% x index price.
 * The engine works over plain price maps (drop-in replaceable with a
 * Fastmarkets/LME feed), marks inventory to market, and produces price
 * sensitivity scenarios.
 *
 * Faithful TypeScript port of marginengine/engine.py.
 */

import { fmtSignedPct } from "../internal/pyformat.js";
import type {
  MarginConfig,
  Prices,
  ProductEconomics,
  SensitivityRow,
} from "./types.js";

/**
 * Latest price per symbol from a price-feed CSV (columns:
 * date,symbol,usd_per_tonne). Later dates win, matching the Python loader.
 */
export function parsePricesCsv(csvText: string): Prices {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length === 0) return {};
  const header = lines[0].split(",").map((c) => c.trim());
  const di = header.indexOf("date");
  const si = header.indexOf("symbol");
  const pi = header.indexOf("usd_per_tonne");
  if (di < 0 || si < 0 || pi < 0) {
    throw new Error("prices CSV must have columns: date,symbol,usd_per_tonne");
  }
  const latest = new Map<string, { date: string; price: number }>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const sym = (cells[si] ?? "").trim();
    const date = (cells[di] ?? "").trim();
    const price = Number(cells[pi]);
    const cur = latest.get(sym);
    if (!cur || date > cur.date) latest.set(sym, { date, price });
  }
  const out: Prices = {};
  for (const [sym, { price }] of latest) out[sym] = price;
  return out;
}

/** Per-product revenue, cost, and margin per metric tonne, marked to inventory. */
export function productEconomics(
  cfg: MarginConfig,
  prices: Prices,
): ProductEconomics[] {
  const out: ProductEconomics[] = [];
  for (const [name, spec] of Object.entries(cfg.products)) {
    const contributions: Record<string, number> = {};
    for (const [metal, assay] of Object.entries(spec.assay)) {
      const symbol = cfg.indices[metal];
      const payable = spec.payables[metal] ?? 0.0;
      contributions[metal] = assay * payable * (prices[symbol] ?? 0.0);
    }
    const revenue = Object.values(contributions).reduce((a, b) => a + b, 0);
    const cost = Number(cfg.cost_per_mt[name] ?? 0.0);
    const invMt = Number((cfg.inventory_mt ?? {})[name] ?? 0.0);
    out.push({
      product: name,
      revenue_per_mt: revenue,
      cost_per_mt: cost,
      margin_per_mt: revenue - cost,
      metal_contributions: contributions,
      inventory_mt: invMt,
      inventory_value: revenue * invMt,
      inventory_margin: (revenue - cost) * invMt,
    });
  }
  return out;
}

function economicsFor(
  cfg: MarginConfig,
  prices: Prices,
  product: string,
): ProductEconomics {
  const econ = productEconomics(cfg, prices).find((p) => p.product === product);
  if (!econ) throw new Error(`Unknown product '${product}'`);
  return econ;
}

/** Margin per MT under uniform and per-metal price shocks. */
export function sensitivity(
  cfg: MarginConfig,
  prices: Prices,
  product: string,
): SensitivityRow[] {
  const shocks: number[] = cfg.sensitivity_shocks ?? [-0.25, -0.1, 0.1, 0.25];
  const spec = cfg.products[product];
  if (!spec) throw new Error(`Unknown product '${product}'`);
  const base = economicsFor(cfg, prices, product);
  const rows: SensitivityRow[] = [];
  const scenarios: Array<[string, string[]]> = [
    ["all metals", Object.keys(spec.assay)],
  ];
  for (const metal of Object.keys(spec.assay)) scenarios.push([metal, [metal]]);
  for (const [label, metals] of scenarios) {
    const row: SensitivityRow = { scenario: label, base: base.margin_per_mt };
    for (const shock of shocks) {
      const shocked: Prices = { ...prices };
      for (const metal of metals) {
        const sym = cfg.indices[metal];
        shocked[sym] = (prices[sym] ?? 0.0) * (1 + shock);
      }
      const econ = economicsFor(cfg, shocked, product);
      row[fmtSignedPct(shock)] = econ.margin_per_mt;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Uniform multiple on all index prices at which margin per MT hits zero,
 * expressed as the implied price for each metal.
 */
export function breakevenPrices(
  cfg: MarginConfig,
  prices: Prices,
  product: string,
): Record<string, number> {
  const base = economicsFor(cfg, prices, product);
  if (base.revenue_per_mt <= 0) return {};
  const multiple = base.cost_per_mt / base.revenue_per_mt;
  const spec = cfg.products[product];
  const out: Record<string, number> = {};
  for (const metal of Object.keys(spec.assay)) {
    out[metal] = (prices[cfg.indices[metal]] ?? 0.0) * multiple;
  }
  return out;
}
