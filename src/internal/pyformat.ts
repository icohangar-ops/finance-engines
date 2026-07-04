/**
 * Minimal Python-format-string equivalents so the TypeScript ports render the
 * exact same human-readable strings as the donor Python engines
 * (f"{x:,.2f}", f"{x:+.0f}", f"{x:g}", f"{x:+.0%}").
 */

/** Python f"{n:.Df}" / f"{n:,.Df}" / f"{n:+.Df}" equivalent. */
export function fmtFixed(
  n: number,
  decimals: number,
  grouping = false,
  forceSign = false,
): string {
  const neg = n < 0 || Object.is(n, -0);
  let s = Math.abs(n).toFixed(decimals);
  if (grouping) {
    const [int, frac] = s.split(".");
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
  }
  const sign = neg ? "-" : forceSign ? "+" : "";
  return sign + s;
}

/** Python f"{n:g}" equivalent (6 significant digits, trailing zeros stripped). */
export function fmtG(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  let s = n.toPrecision(6);
  if (s.includes("e")) {
    let [mantissa, exp] = s.split("e");
    if (mantissa.includes(".")) {
      mantissa = mantissa.replace(/0+$/, "").replace(/\.$/, "");
    }
    const e = parseInt(exp, 10);
    const sign = e < 0 ? "-" : "+";
    return `${mantissa}e${sign}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Python f"{shock:+.0%}" equivalent, e.g. 0.10 -> "+10%", -0.25 -> "-25%". */
export function fmtSignedPct(shock: number): string {
  const pct = Math.round(shock * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** Python round(x, 2) equivalent for the value ranges used by the engines. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
