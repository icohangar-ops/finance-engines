# @cubiczan/finance-engines

**Deterministic finance engines for AI agents: commodity margins, loan
covenants, invoice audit — as a TypeScript library and a licensed MCP
server.**

LLM agents are good at judgment and bad at arithmetic. This package gives them
the arithmetic: three pure, offline, fully deterministic engines that always
return the same numbers for the same inputs — no network, no state, no
hallucinated math. Use them directly from TypeScript/JavaScript, or hand them
to any MCP-compatible agent (Claude Code, Claude Desktop, Cursor, custom
agents) as a stdio tool server.

> **Commercial software.** `UNLICENSED` — all rights reserved. Use requires a
> commercial agreement: **sam@cubiczan.com**. See [LICENSE.md](./LICENSE.md)
> and [PROVENANCE.md](./PROVENANCE.md).

## Engines

- **Margin** — index-linked product economics for commodity processors (e.g.
  battery recycling): revenue/margin per tonne from assay x payable x index
  price, inventory mark-to-market, shock-grid price sensitivity, breakeven
  prices, and config-driven contract structures (grade multiplier, discount +
  profit share, collar, assay payables).
- **Covenant** — loan covenant monitoring: parse a trial balance (Xero payload
  or plain records), compute EBITDA / DSCR / current ratio / leverage /
  liquidity, evaluate against covenant thresholds with headroom, and render a
  signable markdown compliance certificate.
- **Audit** — vendor-invoice anomaly detection for procure-to-pay: duplicate
  invoice numbers, entry lag, overdue-unpaid, amount outliers, unit-rate
  changes, new charge types, unexplained credits, inconsistent tax.

## Quickstart — library

```bash
npm install @cubiczan/finance-engines
```

```ts
import {
  productEconomics, sensitivity, breakevenPrices, evaluateAllContracts,
  parseXeroTrialBalance, computeMetrics, evaluateCovenants, certificateMarkdown,
  runAllAuditRules, normalizeInvoiceNumber,
  defaultMarginConfig, defaultCovenantConfig,
} from "@cubiczan/finance-engines";

// Margins: bring your own config/prices, or use the bundled defaults
const prices = { LI2CO3: 12000, "LME-NI": 16000, "LME-CO": 34000, "LME-CU": 9600 };
const econ = productEconomics(defaultMarginConfig, prices);
const grid = sensitivity(defaultMarginConfig, prices, "black_mass");
const be = breakevenPrices(defaultMarginConfig, prices, "black_mass");
const contracts = evaluateAllContracts(defaultMarginConfig, prices);

// Covenants: trial balance -> metrics -> evaluation -> certificate
const tb = parseXeroTrialBalance(xeroTrialBalanceJson);
const metrics = computeMetrics(tb, defaultCovenantConfig);
const results = evaluateCovenants(metrics, defaultCovenantConfig);
const certificate = certificateMarkdown(results, metrics, "Q2 2026");

// Invoice audit: plain rows in, findings out
const findings = runAllAuditRules(invoiceRows, itemRows, { today: "2026-07-03" });
normalizeInvoiceNumber("#INV20481"); // -> "20481"
```

The engine core has **zero runtime dependencies** (the MCP SDK is only loaded
by the server entry point).

## Quickstart — MCP server

The package ships a stdio MCP server as the `finance-engines-mcp` binary.

```bash
# Claude Code
claude mcp add finance-engines -- npx -y @cubiczan/finance-engines finance-engines-mcp
# or, with the package installed:
claude mcp add finance-engines -- finance-engines-mcp
```

Or in a generic MCP client config:

```json
{
  "mcpServers": {
    "finance-engines": {
      "command": "npx",
      "args": ["-y", "@cubiczan/finance-engines", "finance-engines-mcp"]
    }
  }
}
```

All tools are deterministic and offline. Where `config`/`prices` are optional,
bundled sample defaults apply — supply your own to price your own book.

## MCP tools

| Tool | Engine | What it does |
|---|---|---|
| `product_margins` | margin | Revenue, cost, and margin per MT per product, with metal contributions and inventory mark |
| `price_sensitivity` | margin | Margin/MT scenario grid under uniform and per-metal price shocks |
| `breakeven` | margin | Implied per-metal index prices at which a product's margin hits zero |
| `evaluate_contracts` | margin | Evaluate grade-multiplier / profit-share / collar / assay-payables contract structures at spot |
| `parse_trial_balance` | covenant | Flatten a Xero Reports/TrialBalance payload into netted section balances |
| `compute_covenant_metrics` | covenant | EBITDA, DSCR, current ratio, leverage, liquidity, etc. from a trial balance |
| `evaluate_covenants` | covenant | Test metrics against covenant thresholds with % headroom |
| `compliance_certificate` | covenant | End-to-end signable markdown covenant certificate for a period |
| `audit_invoices` | audit | Run all eight invoice anomaly rules over supplied invoice/item rows |
| `normalize_invoice_number` | audit | Canonicalize an invoice number for duplicate detection |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # builds, then runs all ported suites + MCP smoke test (node --test)
```

The test suites mirror the donor Python test suites number-for-number (same
fixtures, same hand-computed expectations), proving the ports equivalent.

---

Copyright (c) 2026 Shyam Desigan (Cubiczan). All rights reserved.
