# Cross-language parity suite

The finance engine math exists twice: TypeScript in this package, Python in three donor
repos. Nothing previously proved the two computed the same number — so a margin or covenant
figure could drift silently and end up as two different values in front of a lender.

This suite is that proof.

```
spec/
├── fixtures.mjs            shared inputs, deliberately tie-heavy
├── generate_vectors.mjs    regenerates golden-vectors/ from the TS engines
├── golden-vectors/         expected values — generated, never hand-edited
│   ├── pyformat.json       Python format-string equivalence
│   ├── margin.json         product economics, sensitivity, breakeven, contracts
│   ├── covenant.json       metrics, covenant evaluation, trial-balance ingestion
│   └── audit.json          all eight anomaly rules
├── run_parity.py           the runner
└── adapters/
    └── ts_adapter.mjs      TypeScript adapter (the control — must always pass)
```

## Why not just consolidate?

Because the split is deliberate, not accidental. `PROVENANCE.md` records it: this package
holds the **deterministic engine cores plus the MCP tool surface**, while the Python repos
hold the same math **plus** the Xero / Precoro / AlphaVantage integrations and SQLite
persistence that were intentionally not ported. Collapsing them would discard either the
integrations or the dependency-free MCP surface.

What was actually missing was a test proving the shared math agrees. That is a day of work,
not a migration.

## Running it

```bash
npm run build          # the adapters import from dist/

# control: TypeScript against its own vectors
python3 spec/run_parity.py --adapter-cmd "node spec/adapters/ts_adapter.mjs"

# each Python donor engine
python3 spec/run_parity.py --suite pyformat --suite margin \
  --adapter-cmd "python3 ../commodity-margin-engine/spec_adapter.py"
python3 spec/run_parity.py --suite pyformat --suite covenant \
  --adapter-cmd "python3 ../covenant-compliance-tracker/spec_adapter.py"
python3 spec/run_parity.py --suite pyformat --suite audit \
  --adapter-cmd "python3 ../invoice-audit-engine/spec_adapter.py"
```

Exit code is `0` only on full parity. Current state:

| Adapter | Result |
|---|---|
| TypeScript (control, all suites) | 201/201 |
| Python margin | 179/179 |
| Python covenant | 172/172, 1 skipped |
| Python audit | 184/184, 1 skipped |

Skips are honest signature differences, not silent passes: `trialBalanceFromRecords` exists
only in TypeScript (the donor ingests via `covtracker/xero.py` against the live API), and the
donor's `run_all` takes a SQLite connection rather than lists.

## What it found

Building this surfaced four real defects. All are now fixed and pinned by vectors.

**1. The Python-format shims did not match Python.** `src/internal/pyformat.ts` exists
specifically to render the same strings as the donor engines, and it did not. Python rounds
**half-to-even on the exact double**; JavaScript's `Math.round` and `toFixed` round
**half-away-from-zero**. They differ on exact ties — which are common here, because a shock
config of `0.045` or `0.005` times 100 lands on exactly `4.5` and `0.5`:

| input | Python | old TS |
|---|---|---|
| `fmtSignedPct(0.045)` | `+4%` | `+5%` |
| `fmtSignedPct(0.125)` | `+12%` | `+13%` |
| `fmtSignedPct(-0.005)` | `-0%` | `+0%` |
| `round2(2.675)` | `2.67` | `2.68` |
| `round2(1.005)` | `1.0` | `1.01` |

`round2` was worst: its `+ Number.EPSILON` nudge made **4 of 7** sampled values disagree, and
it is used for every contract pricing output. `fmtSignedPct` output is used as an **object
key** in `sensitivity()`, so a caller reading `row["+5%"]` found a number in one
implementation and `undefined` in the other. Rounding is now done exactly with BigInt against
the true value of the double; verified against Python across 2,120 assertions.

**2. Repeated account names silently overwrote balances.** Both `parseXeroTrialBalance` and
`trialBalanceFromRecords` did `sections[section][account] = balance`, so a second row for the
same account discarded the first. A fixture with `Cash at Bank` twice (890,000 then 10,000)
returned **10,000**. Now accumulates. In a covenant certificate that understatement can flip
a breach into apparent compliance.

**3. A malformed `collar` spec priced at zero instead of failing.** `collar` takes `metal`
(singular) while every other contract type takes `metals`. Given the wrong key, Python raised
`KeyError` while TypeScript silently resolved spot to `0.0` and reported the floor as binding.
Failing loudly is right for a pricing engine; the vectors now cover both collar branches.

**4. `src/audit/rules.ts` contained raw NUL bytes.** Used as a composite-key separator but
written as literal `\x00` bytes rather than the escape, which made the file register as binary
— `grep` silently skipped it, returning no matches rather than an error. Replaced with the
escape sequence.

## Adding coverage

1. Add inputs to `fixtures.mjs`.
2. `node spec/generate_vectors.mjs`
3. Review the vector diff. A large diff means you changed more than you intended.
4. Add the op to `run_parity.py` and to each adapter that implements it.

Never hand-edit a golden vector. If one looks wrong, the engine is wrong.

**Prefer tie-prone inputs.** Values like `0.125`, `2.675`, `1.005`, `0.045` and `-0.005` are
where the two runtimes actually diverge; round numbers agree trivially and prove little.

## Protocol

One JSON request per line on stdin, one response per line on stdout — the same contract the
CHP conformance suite uses, so there is one adapter shape to learn across the portfolio:

```
-> {"op": "covenant.metrics", "args": {"tb": {...}, "cfg": {...}}}
<- {"ok": true, "result": {...}}
<- {"ok": false, "error": "unsupported op"}
```

`unsupported op` reports SKIP, not FAIL. Non-finite numbers travel as the strings
`"Infinity"` / `"-Infinity"` / `"NaN"`, because JSON cannot represent them and
`debt_to_net_worth` is genuinely infinite when equity is zero or negative. **Adapters must
decode inbound arguments as well as encode results** — JavaScript will happily coerce the
string `"Infinity"` in a `>=` comparison and appear to work, while Python raises, so relying
on coercion would make the two sides disagree for a reason unrelated to the engines.
