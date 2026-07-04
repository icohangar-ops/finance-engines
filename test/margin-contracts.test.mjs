// Contract structure tests with hand-computed expectations.
// Mirrors commodity-margin-engine/tests/test_contracts.py.

import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultMarginConfig,
  evaluateAllContracts,
  evaluateContract,
} from "../dist/index.js";
import { assertApprox } from "./helpers.mjs";

const INDICES = { nickel: "LME-NI", cobalt: "LME-CO", lithium: "LI2CO3" };
const PRICES = { "LME-NI": 22000.0, "LME-CO": 35000.0, LI2CO3: 18000.0 };

test("grade multiplier", () => {
  const spec = {
    type: "grade_multiplier",
    metals: ["nickel", "cobalt"],
    grade_multiplier: 0.85,
  };
  const r = evaluateContract("bm", spec, PRICES, INDICES);
  assertApprox(r.outputs.nickel_payable_usd_per_mt, 18700.0);
  assertApprox(r.outputs.cobalt_payable_usd_per_mt, 29750.0);
  assertApprox(r.outputs.total_value_per_mt, 48450.0);
});

test("profit share triggered above threshold", () => {
  const spec = {
    type: "discount_profit_share",
    metals: ["nickel", "cobalt"],
    floor_discount: 0.08,
    profit_share: { metal: "nickel", threshold_usd_per_mt: 20000, share: 0.15 },
  };
  const r = evaluateContract("mhp", spec, PRICES, INDICES);
  // floor: 22000*0.92=20240; incremental 2000; share 300; realized 19940
  assertApprox(r.outputs.floor_nickel_usd_per_mt, 20240.0);
  assertApprox(r.outputs.profit_share_amount, 300.0);
  assertApprox(r.outputs.realized_nickel_usd_per_mt, 19940.0);
  assert.equal(r.flags.profit_share_triggered, true);
});

test("profit share not triggered below threshold", () => {
  const spec = {
    type: "discount_profit_share",
    metals: ["nickel"],
    floor_discount: 0.08,
    profit_share: { metal: "nickel", threshold_usd_per_mt: 20000, share: 0.15 },
  };
  const r = evaluateContract("mhp", spec, { "LME-NI": 18000.0 }, INDICES);
  assert.equal(r.outputs.profit_share_amount, 0.0);
  assert.equal(r.flags.profit_share_triggered, false);
});

test("collar clamps both sides", () => {
  const spec = {
    type: "collar",
    metal: "lithium",
    floor_usd_per_mt: 20000,
    ceiling_usd_per_mt: 30000,
  };
  const low = evaluateContract("gtc", spec, { LI2CO3: 18000.0 }, INDICES);
  assert.equal(low.outputs.effective_usd_per_mt, 20000.0);
  assert.equal(low.flags.floor_binding, true);
  const high = evaluateContract("gtc", spec, { LI2CO3: 32000.0 }, INDICES);
  assert.equal(high.outputs.effective_usd_per_mt, 30000.0);
  assert.equal(high.flags.ceiling_binding, true);
  const mid = evaluateContract("gtc", spec, { LI2CO3: 25000.0 }, INDICES);
  assert.equal(mid.outputs.effective_usd_per_mt, 25000.0);
  assert.ok(!mid.flags.floor_binding && !mid.flags.ceiling_binding);
});

test("assay payables", () => {
  const spec = {
    type: "assay_payables",
    assay: { nickel: 0.03, cobalt: 0.02 },
    payables: { nickel: 0.9, cobalt: 0.9 },
  };
  const r = evaluateContract("feedstock", spec, PRICES, INDICES);
  // ni: .03*.9*22000=594; co: .02*.9*35000=630
  assertApprox(r.outputs.total_value_per_mt, 1224.0);
});

test("evaluate all from config", () => {
  const results = evaluateAllContracts(defaultMarginConfig, PRICES);
  const names = new Set(results.map((r) => r.name));
  for (const expected of ["black-mass-payables", "mhp-offtake", "li-carbonate-gtc"]) {
    assert.ok(names.has(expected), `missing contract ${expected}`);
  }
});

test("unknown type throws", () => {
  assert.throws(
    () => evaluateContract("x", { type: "nope" }, PRICES, INDICES),
    /Unknown contract type/,
  );
});
