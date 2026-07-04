// Covenant engine tests against the demo trial balance fixture.
// Mirrors covenant-compliance-tracker/tests/test_engine.py.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  certificateMarkdown,
  computeMetrics,
  defaultCovenantConfig,
  evaluateCovenants,
  parseXeroTrialBalance,
} from "../dist/index.js";
import { assertApprox } from "./helpers.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/reports_trialbalance.json", import.meta.url),
    "utf8",
  ),
);

function metrics() {
  const tb = parseXeroTrialBalance(fixture);
  return [tb, computeMetrics(tb, defaultCovenantConfig)];
}

test("parse sections", () => {
  const [tb] = metrics();
  assert.equal(tb.revenue["Product Sales (400)"], 2_850_000);
  assert.equal(tb.assets["Business Bank Checking (090)"], 742_000);
  // accumulated depreciation is a credit-balance asset -> negative
  assert.equal(tb.assets["Accumulated Depreciation (711)"], -1_260_000);
});

test("metric math", () => {
  const [, m] = metrics();
  // revenue 3,470,000 - expenses 3,667,000 = net income -197,000
  assert.equal(Math.round(m.net_income), -197_000);
  // EBITDA adds back depreciation 420k + interest 365k = 588,000
  assert.equal(Math.round(m.ebitda), 588_000);
  // current assets 1,798,000 / current liabilities (AP+accrued+current portion) 1,240,000
  assertApprox(m.current_ratio, 1_798_000 / 1_240_000, 5e-4);
  assert.equal(Math.round(m.total_debt), 5_800_000);
});

test("evaluation flags breach", () => {
  const [, m] = metrics();
  const results = evaluateCovenants(m, defaultCovenantConfig);
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  // DSCR = 588,000 / 1,200,000 = 0.49 -> breach of 1.25
  assert.equal(byName["Debt Service Coverage Ratio"].compliant, false);
  assert.equal(byName["Current Ratio"].compliant, true);
  assert.equal(byName["Minimum Liquidity"].compliant, true);
});

test("certificate contains all covenants", () => {
  const [, m] = metrics();
  const results = evaluateCovenants(m, defaultCovenantConfig);
  const md = certificateMarkdown(results, m, "2026-06-30");
  for (const r of results) {
    assert.ok(md.includes(r.name), `certificate missing ${r.name}`);
  }
  assert.ok(md.includes("BREACH"));
});
