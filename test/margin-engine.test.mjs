// Margin engine tests with hand-computed expectations.
// Mirrors commodity-margin-engine/tests/test_engine.py.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  breakevenPrices,
  defaultMarginConfig,
  parsePricesCsv,
  productEconomics,
  sensitivity,
} from "../dist/index.js";
import { assertApprox } from "./helpers.mjs";

const PRICES = {
  LI2CO3: 12000.0,
  "LME-NI": 16000.0,
  "LME-CO": 34000.0,
  "LME-CU": 9600.0,
};

const cfg = () => defaultMarginConfig;

const byProduct = (prices) =>
  Object.fromEntries(productEconomics(cfg(), prices).map((e) => [e.product, e]));

test("black mass revenue math", () => {
  const bm = byProduct(PRICES).black_mass;
  // li: .035*.55*12000=231; ni: .20*.70*16000=2240; co: .07*.65*34000=1547; cu: .02*.60*9600=115.2
  assertApprox(bm.metal_contributions.lithium, 231.0);
  assertApprox(bm.metal_contributions.nickel, 2240.0);
  assertApprox(bm.metal_contributions.cobalt, 1547.0);
  assertApprox(bm.revenue_per_mt, 231.0 + 2240.0 + 1547.0 + 115.2);
  assertApprox(bm.margin_per_mt, bm.revenue_per_mt - 2100.0);
});

test("inventory mark", () => {
  const bm = byProduct(PRICES).black_mass;
  assertApprox(bm.inventory_value, bm.revenue_per_mt * 120);
});

test("sensitivity monotonic", () => {
  const rows = sensitivity(cfg(), PRICES, "black_mass");
  const allMetals = rows.find((r) => r.scenario === "all metals");
  assert.ok(allMetals["-25%"] < allMetals["-10%"]);
  assert.ok(allMetals["-10%"] < allMetals.base);
  assert.ok(allMetals.base < allMetals["+10%"]);
  assert.ok(allMetals["+10%"] < allMetals["+25%"]);
  // single-metal shock moves margin less than all-metals shock
  const nickel = rows.find((r) => r.scenario === "nickel");
  assert.ok(
    Math.abs(nickel["+25%"] - nickel.base) <
      Math.abs(allMetals["+25%"] - allMetals.base),
  );
});

test("breakeven zeroes margin", () => {
  const config = cfg();
  const be = breakevenPrices(config, PRICES, "black_mass");
  const shocked = { ...PRICES };
  for (const [metal, price] of Object.entries(be)) {
    shocked[config.indices[metal]] = price;
  }
  const econ = byProduct(shocked);
  assertApprox(econ.black_mass.margin_per_mt, 0.0, 1e-6);
});

test("price loader takes latest", () => {
  const csv = readFileSync(
    new URL("./fixtures/prices_sample.csv", import.meta.url),
    "utf8",
  );
  const prices = parsePricesCsv(csv);
  assert.equal(prices.LI2CO3, 12050.0); // 2026-07-01 row wins
});
