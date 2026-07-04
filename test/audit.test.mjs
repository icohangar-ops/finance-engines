// Unit tests for audit rules using a synthetic field-services vendor that
// exhibits the billing patterns this engine is designed to catch.
// Mirrors invoice-audit-engine/tests/test_rules.py (rows are plain objects
// instead of SQLite; overdue tests pin `today` to the date the Python suite
// was authored against so results are reproducible).

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeInvoiceNumber, runAllAuditRules } from "../dist/index.js";

const TODAY = "2026-07-03";

function inv(id, num, issue, created, total, paid = 0.0, status = 2, supplier = 1) {
  return {
    id,
    invoice_number: num,
    supplier_id: supplier,
    supplier_name: `Vendor ${supplier}`,
    issue_date: issue,
    create_date: created,
    required_date: issue,
    sum: total,
    net_sum: total,
    sum_paid: paid,
    status,
    currency: "USD",
  };
}

function item(invId, name, price, tax = null, lineSum = null) {
  return {
    invoice_id: invId,
    name,
    price,
    quantity: null,
    line_sum: lineSum ?? price,
    tax_percent: tax,
  };
}

test("normalize number collides typos", () => {
  assert.equal(
    normalizeInvoiceNumber("#INV20481"),
    normalizeInvoiceNumber("NV20481"),
  );
  assert.equal(
    normalizeInvoiceNumber("INV-123"),
    normalizeInvoiceNumber("inv123"),
  );
});

test("duplicate detection", () => {
  const invoices = [
    inv(1, "INV100", "2026-01-01", "2026-01-02", 500),
    inv(2, "#INV100", "2026-01-05", "2026-01-06", 500),
  ];
  const rules = runAllAuditRules(invoices, [], { today: TODAY }).map((f) => f.rule);
  assert.ok(rules.includes("duplicate_invoice_number"));
});

test("entry lag flagged", () => {
  const invoices = [inv(1, "A1", "2026-02-17", "2026-05-08", 3565)]; // ~11 weeks late
  const fs = runAllAuditRules(invoices, [], { today: TODAY }).filter(
    (f) => f.rule === "entry_lag",
  );
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, "high");
});

test("rate change flagged", () => {
  const invoices = [
    inv(1, "A1", "2026-02-01", "2026-02-02", 1000),
    inv(2, "A2", "2026-03-27", "2026-03-28", 1000),
  ];
  const items = [
    item(1, "Disposal (BBL)", 1.0),
    item(2, "Disposal (BBL)", 1.5), // unagreed 50% jump
  ];
  const fs = runAllAuditRules(invoices, items, { today: TODAY }).filter(
    (f) => f.rule === "rate_change",
  );
  assert.equal(fs.length, 1);
  assert.ok(fs[0].detail.includes("+50%"));
});

test("new charge type after baseline", () => {
  const invoices = [];
  const items = [];
  ["01", "02", "03", "04"].forEach((month, idx) => {
    const i = idx + 1;
    invoices.push(inv(i, `A${i}`, `2026-${month}-01`, `2026-${month}-02`, 1000));
    items.push(item(i, "Hourly Service", 150));
  });
  invoices.push(inv(5, "A5", "2026-05-01", "2026-05-02", 1000));
  items.push(item(5, "Hourly Service", 150));
  items.push(item(5, "fuel adjustment", 263.25)); // surcharge creep
  const fs = runAllAuditRules(invoices, items, { today: TODAY }).filter(
    (f) => f.rule === "new_charge_type",
  );
  assert.deepEqual(fs.map((f) => f.invoice_number), ["A5"]);
});

test("inconsistent tax", () => {
  const invoices = [
    inv(1, "A1", "2026-03-27", "2026-03-28", 1000),
    inv(2, "A2", "2026-04-15", "2026-04-16", 1000),
  ];
  const items = [
    item(1, "Disposal (BBL)", 1.5, 8.625),
    item(2, "Disposal (BBL)", 1.5, null),
  ];
  const fs = runAllAuditRules(invoices, items, { today: TODAY }).filter(
    (f) => f.rule === "inconsistent_tax",
  );
  assert.equal(fs.length, 1);
});

test("overdue unpaid", () => {
  const invoices = [inv(1, "A1", "2026-02-06", "2026-02-07", 4840, 0, 2)];
  const fs = runAllAuditRules(invoices, [], { today: TODAY }).filter(
    (f) => f.rule === "overdue_unpaid",
  );
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, "high");
});

test("paid invoice not overdue", () => {
  const invoices = [inv(1, "A1", "2026-02-06", "2026-02-07", 4840, 4840, 5)];
  const fs = runAllAuditRules(invoices, [], { today: TODAY }).filter(
    (f) => f.rule === "overdue_unpaid",
  );
  assert.equal(fs.length, 0);
});

test("amount outlier", () => {
  const invoices = [];
  for (let i = 1; i < 5; i++) {
    invoices.push(inv(i, `A${i}`, `2026-0${i}-01`, `2026-0${i}-02`, 2000));
  }
  invoices.push(inv(9, "A9", "2026-05-01", "2026-05-02", 9000));
  const fs = runAllAuditRules(invoices, [], { today: TODAY }).filter(
    (f) => f.rule === "amount_outlier",
  );
  assert.deepEqual(fs.map((f) => f.invoice_number), ["A9"]);
});
