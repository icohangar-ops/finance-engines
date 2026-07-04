/**
 * Default margin config and sample price feed. These mirror the donor
 * engine's config/margin.yaml and config/prices_sample.csv verbatim, so the
 * MCP tools work out of the box when no config/prices are supplied.
 */

import { parsePricesCsv } from "./engine.js";
import type { MarginConfig, Prices } from "./types.js";

export const SAMPLE_PRICES_CSV = `date,symbol,usd_per_tonne
2026-06-27,LI2CO3,11800
2026-06-27,LME-NI,16850
2026-06-27,LME-CO,33500
2026-06-27,LME-CU,9620
2026-06-30,LI2CO3,11950
2026-06-30,LME-NI,16700
2026-06-30,LME-CO,34100
2026-06-30,LME-CU,9580
2026-07-01,LI2CO3,12050
2026-07-01,LME-NI,16780
2026-07-01,LME-CO,34350
2026-07-01,LME-CU,9640
`;

export const defaultMarginConfig: MarginConfig = {
  products: {
    black_mass: {
      description: "NMC black mass, per dry MT",
      assay: { lithium: 0.035, nickel: 0.2, cobalt: 0.07, copper: 0.02 },
      payables: { lithium: 0.55, nickel: 0.7, cobalt: 0.65, copper: 0.6 },
    },
    mhp: {
      description: "Mixed hydroxide precipitate, per dry MT",
      assay: { nickel: 0.38, cobalt: 0.04 },
      payables: { nickel: 0.8, cobalt: 0.75 },
    },
  },
  indices: {
    lithium: "LI2CO3",
    nickel: "LME-NI",
    cobalt: "LME-CO",
    copper: "LME-CU",
  },
  cost_per_mt: { black_mass: 2100, mhp: 3400 },
  inventory_mt: { black_mass: 120, mhp: 0 },
  sensitivity_shocks: [-0.25, -0.1, 0.1, 0.25],
  contracts: {
    "black-mass-payables": {
      type: "grade_multiplier",
      description:
        "Intermediate sold on contained metal value at a grade multiplier",
      metals: ["nickel", "cobalt"],
      grade_multiplier: 0.85,
    },
    "mhp-offtake": {
      type: "discount_profit_share",
      description: "Offtake with structural discount and upside profit share",
      metals: ["nickel", "cobalt"],
      floor_discount: 0.08,
      profit_share: { metal: "nickel", threshold_usd_per_mt: 20000, share: 0.15 },
    },
    "li-carbonate-gtc": {
      type: "collar",
      description: "Lithium carbonate GTC with floor and ceiling",
      metal: "lithium",
      floor_usd_per_mt: 20000,
      ceiling_usd_per_mt: 30000,
    },
  },
};

/** Latest sample prices (per symbol) parsed from the bundled sample feed. */
export function samplePrices(): Prices {
  return parsePricesCsv(SAMPLE_PRICES_CSV);
}
