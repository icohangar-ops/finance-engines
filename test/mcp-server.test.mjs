// MCP server smoke test: spawn the stdio server, list tools, and call tools
// on sample inputs. Fully offline.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = fileURLToPath(new URL("../dist/mcp-server.js", import.meta.url));

const EXPECTED_TOOLS = [
  "product_margins",
  "price_sensitivity",
  "breakeven",
  "evaluate_contracts",
  "parse_trial_balance",
  "compute_covenant_metrics",
  "evaluate_covenants",
  "compliance_certificate",
  "audit_invoices",
  "normalize_invoice_number",
  "uipath_handoff",
];

test("MCP server lists tools and answers calls", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    stderr: "pipe",
  });
  const client = new Client({ name: "finance-engines-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    // 1. Tool listing
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const name of EXPECTED_TOOLS) {
      assert.ok(names.has(name), `missing tool ${name}`);
    }

    // 2. Plain string tool
    const norm = await client.callTool({
      name: "normalize_invoice_number",
      arguments: { number: "#INV20481" },
    });
    assert.equal(norm.content[0].text, "20481");

    // 3. Numeric tool on a sample input (same numbers as the Python suite)
    const prices = {
      LI2CO3: 12000.0,
      "LME-NI": 16000.0,
      "LME-CO": 34000.0,
      "LME-CU": 9600.0,
    };
    const res = await client.callTool({
      name: "product_margins",
      arguments: { prices },
    });
    const products = JSON.parse(res.content[0].text);
    const bm = products.find((p) => p.product === "black_mass");
    assert.ok(bm, "black_mass product missing");
    assert.ok(Math.abs(bm.revenue_per_mt - 4133.2) < 1e-6);
    assert.ok(Math.abs(bm.margin_per_mt - (4133.2 - 2100)) < 1e-6);

    // 4. Audit tool round-trip
    const audit = await client.callTool({
      name: "audit_invoices",
      arguments: {
        invoices: [
          {
            id: 1,
            invoice_number: "INV100",
            supplier_id: 1,
            supplier_name: "Vendor 1",
            issue_date: "2026-01-01",
            create_date: "2026-01-02",
            required_date: "2026-01-01",
            sum: 500,
            sum_paid: 500,
            status: 5,
          },
          {
            id: 2,
            invoice_number: "#INV100",
            supplier_id: 1,
            supplier_name: "Vendor 1",
            issue_date: "2026-01-05",
            create_date: "2026-01-06",
            required_date: "2026-01-05",
            sum: 500,
            sum_paid: 500,
            status: 5,
          },
        ],
        today: "2026-07-03",
      },
    });
    const findings = JSON.parse(audit.content[0].text);
    assert.deepEqual(
      findings.map((f) => f.rule),
      ["duplicate_invoice_number"],
    );

    // 5. UiPath handoff wrapper should dispatch to the same audit engine.
    const handoff = await client.callTool({
      name: "uipath_handoff",
      arguments: {
        kind: "audit_invoices",
        source: "uipath",
        summary: "UiPath invoice handoff",
        invoices: [
          {
            id: 1,
            invoice_number: "INV100",
            supplier_id: 1,
            supplier_name: "Vendor 1",
            issue_date: "2026-01-01",
            create_date: "2026-01-02",
            required_date: "2026-01-01",
            sum: 500,
            sum_paid: 500,
            status: 5,
          },
          {
            id: 2,
            invoice_number: "#INV100",
            supplier_id: 1,
            supplier_name: "Vendor 1",
            issue_date: "2026-01-05",
            create_date: "2026-01-06",
            required_date: "2026-01-05",
            sum: 500,
            sum_paid: 500,
            status: 5,
          },
        ],
      },
    });
    const wrapped = JSON.parse(handoff.content[0].text);
    assert.equal(wrapped.kind, "audit_invoices");
    assert.equal(wrapped.source, "uipath");
    assert.equal(wrapped.result[0].rule, "duplicate_invoice_number");
  } finally {
    await client.close();
  }
});
