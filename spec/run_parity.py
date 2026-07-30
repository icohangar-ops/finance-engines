#!/usr/bin/env python3
"""Cross-language parity runner for the finance engines.

The same financial formulas exist twice — TypeScript in this package, Python in
the donor repos (commodity-margin-engine, covenant-compliance-tracker,
invoice-audit-engine). Nothing previously proved they computed the same number,
so a margin or covenant figure could drift silently and end up as two different
numbers in front of a lender. This runner is that proof.

    # the TS side must always pass (it generates the vectors)
    python3 spec/run_parity.py --adapter-cmd "node spec/adapters/ts_adapter.mjs"

    # a Python donor engine
    python3 spec/run_parity.py \
        --adapter-cmd "python3 ../commodity-margin-engine/spec_adapter.py" \
        --suite margin

Exit status is 0 only when every selected vector matches, so this drops into CI.

Adapter protocol is the same line-JSON contract used by the CHP conformance
suite — one JSON request per line on stdin, one response per line on stdout:

    -> {"op": "margin.product_economics", "args": {...}}
    <- {"ok": true, "result": [...]}
    <- {"ok": false, "error": "unsupported op"}

`unsupported op` reports SKIP rather than FAIL, so a single-engine adapter is not
penalised for the ops it does not implement.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
VECTORS = HERE / "golden-vectors"

#: Relative tolerance for float comparison. The two runtimes both use IEEE-754
#: doubles and the operation order is intended to be identical, so anything
#: beyond this is a real algebraic difference rather than representation noise.
REL_TOL = 1e-12
ABS_TOL = 1e-9


class Unsupported(Exception):
    pass


def decode(value: Any) -> Any:
    """Turn the JSON non-finite encoding back into floats."""
    if isinstance(value, str):
        if value == "Infinity":
            return math.inf
        if value == "-Infinity":
            return -math.inf
        if value == "NaN":
            return math.nan
        return value
    if isinstance(value, list):
        return [decode(v) for v in value]
    if isinstance(value, dict):
        return {k: decode(v) for k, v in value.items()}
    return value


def encode(value: Any) -> Any:
    """Inverse of :func:`decode`, for outbound request arguments.

    Needed because decoded vectors are fed back to adapters as inputs (e.g. the
    `metrics` dict passed to covenant.evaluate contains inf). Python's
    ``json.dumps`` would emit a bare ``Infinity`` token, which is not valid JSON
    and which Node's ``JSON.parse`` rejects outright.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if value == math.inf:
            return "Infinity"
        if value == -math.inf:
            return "-Infinity"
        return value
    if isinstance(value, list):
        return [encode(v) for v in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    return value


class Adapter:
    def __init__(self, cmd: str) -> None:
        self.name = cmd
        self.proc = subprocess.Popen(
            cmd, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )

    def call(self, op: str, args: dict[str, Any]) -> Any:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps({"op": op, "args": encode(args)}) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            err = (self.proc.stderr.read() if self.proc.stderr else "") or "adapter closed stdout"
            raise RuntimeError(f"adapter died on op {op!r}: {err.strip()[:500]}")
        resp = json.loads(line)
        if not resp.get("ok"):
            msg = str(resp.get("error", ""))
            if "unsupported" in msg.lower():
                raise Unsupported(op)
            raise AssertionError(msg or "adapter reported failure")
        return decode(resp.get("result"))

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()


def close_enough(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(a) and math.isnan(b):
            return True
        if math.isinf(a) or math.isinf(b):
            return a == b
        return math.isclose(float(a), float(b), rel_tol=REL_TOL, abs_tol=ABS_TOL)
    return a == b


def compare(actual: Any, expected: Any, path: str = "") -> list[str]:
    """Return a list of human-readable difference descriptions (empty == match)."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path or '<root>'}: expected object, got {type(actual).__name__}"]
        diffs = []
        for k, v in expected.items():
            if k not in actual:
                diffs.append(f"{path}.{k}: missing from adapter output")
            else:
                diffs += compare(actual[k], v, f"{path}.{k}")
        # Extra keys are tolerated: an implementation may carry its own metadata.
        return diffs
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{path or '<root>'}: expected array, got {type(actual).__name__}"]
        if len(actual) != len(expected):
            return [f"{path}: length {len(actual)} != expected {len(expected)}"]
        diffs = []
        for i, (a, e) in enumerate(zip(actual, expected)):
            diffs += compare(a, e, f"{path}[{i}]")
        return diffs
    if not close_enough(actual, expected):
        return [f"{path or '<root>'}: {actual!r} != expected {expected!r}"]
    return []


def canonical_findings(findings: list[dict]) -> list[str]:
    """Order-insensitive key for a findings multiset.

    Neither engine promises an emission order, so requiring one would make the
    suite brittle for no gain. Content still has to match exactly.
    """
    return sorted(
        json.dumps({k: f.get(k) for k in ("rule", "severity", "supplier_name",
                                          "invoice_number", "detail", "amount")},
                   sort_keys=True)
        for f in findings
    )


class Results:
    def __init__(self) -> None:
        self.passed = 0
        self.failed: list[tuple[str, list[str]]] = []
        self.skipped: list[str] = []

    def check(self, name: str, expected: Any, call: Callable[[], Any],
              *, findings: bool = False) -> None:
        try:
            actual = call()
        except Unsupported:
            self.skipped.append(name)
            return
        except Exception as exc:
            self.failed.append((name, [f"adapter raised {type(exc).__name__}: {exc}"]))
            return
        if findings:
            diffs = compare(canonical_findings(actual), canonical_findings(expected))
        else:
            diffs = compare(actual, expected)
        if diffs:
            self.failed.append((name, diffs))
        else:
            self.passed += 1


def load(name: str) -> dict:
    return decode(json.loads((VECTORS / name).read_text(encoding="utf-8")))


# ------------------------------------------------------------------ suites


def run_pyformat(ad: Adapter, r: Results) -> None:
    d = load("pyformat.json")
    for case in d["cases"]:
        n = case["input"]
        # JSON cannot carry -0; the vector flags it so the adapter can rebuild it.
        neg_zero = bool(case.get("negative_zero"))
        label = "-0" if neg_zero else repr(n)
        base = {"n": n, "negative_zero": neg_zero}
        r.check(f"pyformat/{label}/fixed_2", case["fixed_2"],
                lambda base=base: ad.call("pyformat.fixed", {**base, "decimals": 2}))
        r.check(f"pyformat/{label}/fixed_2_grouped", case["fixed_2_grouped"],
                lambda base=base: ad.call("pyformat.fixed", {**base, "decimals": 2, "grouping": True}))
        r.check(f"pyformat/{label}/fixed_0_signed", case["fixed_0_signed"],
                lambda base=base: ad.call("pyformat.fixed", {**base, "decimals": 0, "force_sign": True}))
        r.check(f"pyformat/{label}/signed_pct", case["signed_pct"],
                lambda base=base: ad.call("pyformat.signed_pct", base))
        r.check(f"pyformat/{label}/round_2", case["round_2"],
                lambda base=base: ad.call("pyformat.round2", base))
        r.check(f"pyformat/{label}/g", case["g"],
                lambda base=base: ad.call("pyformat.g", base))


def run_margin(ad: Adapter, r: Results) -> None:
    d = load("margin.json")
    cfg, prices = d["config"], d["prices"]
    r.check("margin/parse_prices_csv", d["parse_prices_csv"],
            lambda: ad.call("margin.parse_prices_csv", {"csv": d["prices_csv"]}))
    r.check("margin/product_economics", d["product_economics"],
            lambda: ad.call("margin.product_economics", {"cfg": cfg, "prices": prices}))
    for product, expected in d["sensitivity"].items():
        r.check(f"margin/sensitivity/{product}", expected,
                lambda p=product: ad.call("margin.sensitivity",
                                          {"cfg": cfg, "prices": prices, "product": p}))
    for product, expected in d["breakeven"].items():
        r.check(f"margin/breakeven/{product}", expected,
                lambda p=product: ad.call("margin.breakeven",
                                          {"cfg": cfg, "prices": prices, "product": p}))
    for name, entry in d["contracts"].items():
        r.check(f"margin/contract/{name}", entry["result"],
                lambda n=name, e=entry: ad.call("margin.contract", {
                    "name": n, "spec": e["spec"], "prices": prices,
                    "indices": cfg["indices"]}))


def run_covenant(ad: Adapter, r: Results) -> None:
    d = load("covenant.json")
    cfg = d["config"]
    r.check("covenant/metrics", d["metrics"],
            lambda: ad.call("covenant.metrics", {"tb": d["trial_balance"], "cfg": cfg}))
    r.check("covenant/evaluate", d["evaluate"],
            lambda: ad.call("covenant.evaluate", {"metrics": d["metrics"], "cfg": cfg}))
    ins = d["insolvent"]
    r.check("covenant/metrics/insolvent-infinite-leverage", ins["metrics"],
            lambda: ad.call("covenant.metrics", {"tb": ins["trial_balance"], "cfg": cfg}))
    r.check("covenant/evaluate/insolvent", ins["evaluate"],
            lambda: ad.call("covenant.evaluate", {"metrics": ins["metrics"], "cfg": cfg}))
    tbr = d["trial_balance_from_records"]
    r.check("covenant/trial_balance_from_records", tbr["result"],
            lambda: ad.call("covenant.trial_balance_from_records", {"records": tbr["records"]}))


def run_audit(ad: Adapter, r: Results) -> None:
    d = load("audit.json")
    cfg, invoices, items = d["config"], d["invoices"], d["items"]
    for raw, expected in d["normalize_number"].items():
        r.check(f"audit/normalize_number/{raw!r}", expected,
                lambda raw=raw: ad.call("audit.normalize_number", {"num": raw}))
    header_only = {"duplicate_numbers", "entry_lag", "overdue_unpaid", "amount_outliers"}
    for rule, expected in d["rules"].items():
        args: dict[str, Any] = {"invoices": invoices, "cfg": cfg}
        if rule not in header_only:
            args["items"] = items
        r.check(f"audit/{rule}", expected,
                lambda rule=rule, args=args: ad.call(f"audit.{rule}", args),
                findings=True)
    r.check("audit/run_all", d["run_all"],
            lambda: ad.call("audit.run_all",
                            {"invoices": invoices, "items": items, "cfg": cfg}),
            findings=True)


SUITES = {
    "pyformat": run_pyformat,
    "margin": run_margin,
    "covenant": run_covenant,
    "audit": run_audit,
}


def main() -> int:
    ap = argparse.ArgumentParser(description="finance-engines cross-language parity runner")
    ap.add_argument("--adapter-cmd", required=True, help="adapter command (line-JSON protocol)")
    ap.add_argument("--suite", action="append", choices=sorted(SUITES),
                    help="limit to one or more suites (default: all)")
    ap.add_argument("--quiet", action="store_true", help="summary only")
    args = ap.parse_args()

    chosen = args.suite or sorted(SUITES)
    ad = Adapter(args.adapter_cmd)
    r = Results()
    try:
        for suite in chosen:
            SUITES[suite](ad, r)
    finally:
        ad.close()

    total = r.passed + len(r.failed)
    print(f"\nfinance-engines parity — adapter: {ad.name}")
    print(f"  suites  {', '.join(chosen)}")
    print(f"  passed  {r.passed}/{total}")
    if r.skipped:
        print(f"  skipped {len(r.skipped)} (unsupported ops)")
        if not args.quiet:
            for s in r.skipped[:20]:
                print(f"            - {s}")
            if len(r.skipped) > 20:
                print(f"            … and {len(r.skipped) - 20} more")
    if r.failed:
        print(f"  FAILED  {len(r.failed)}")
        for name, diffs in r.failed:
            print(f"\n  x {name}")
            for diff in diffs[:6]:
                print(f"      {diff}")
            if len(diffs) > 6:
                print(f"      … and {len(diffs) - 6} more differences")
        return 1
    print("  result  PARITY CONFIRMED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
