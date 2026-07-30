/**
 * Minimal Python-format-string equivalents so the TypeScript ports render the
 * exact same human-readable strings as the donor Python engines
 * (f"{x:,.2f}", f"{x:+.0f}", f"{x:g}", f"{x:+.0%}").
 *
 * The subtlety that makes this file non-trivial: **Python rounds half-to-even on
 * the exact binary value of the double, while JavaScript's `Math.round` and
 * `Number.prototype.toFixed` round half-away-from-zero.** They agree on almost
 * every input and disagree on exact ties — which are not rare in this domain,
 * because a shock config of 0.045 or 0.005 multiplied by 100 lands on exactly
 * 4.5 and 0.5:
 *
 *     Python  f"{0.045:+.0%}" -> "+4%"      naive Math.round -> "+5%"
 *     Python  round(0.125, 2) -> 0.12       naive toFixed(2) -> "0.13"
 *
 * Those strings are used as **object keys** in `sensitivity()` output, so a
 * divergence is not cosmetic: a caller reading `row["+5%"]` finds a number in
 * one implementation and `undefined` in the other.
 *
 * So rounding here is done exactly, with BigInt, against the true value of the
 * double — no epsilon nudges, and no float multiplication before rounding. The
 * pinned cases live in ../../spec/golden-vectors/pyformat.json.
 */

/**
 * Decompose a finite double so that its exact value is
 * `sign * mantissa * 2**exponent`, with `mantissa` a BigInt.
 */
function decompose(x: number): { sign: bigint; mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));

  const sign = (bits >> 63n) & 1n ? -1n : 1n;
  const rawExp = Number((bits >> 52n) & 0x7ffn);
  const rawFrac = bits & 0xfffffffffffffn;

  if (rawExp === 0) {
    // Subnormal: no implicit leading 1 bit.
    return { sign, mantissa: rawFrac, exponent: -1074 };
  }
  return { sign, mantissa: rawFrac | 0x10000000000000n, exponent: rawExp - 1075 };
}

/**
 * Round the magnitude of `x` to `decimals` places with Python's rule —
 * round-half-to-even on the double's exact value — returning the scaled integer
 * (the result is `scaled / 10**decimals`).
 *
 * Exact by construction: the true value is `mantissa * 2**exponent`, so
 * `value * 10**decimals` is a ratio of integers and the tie test is an integer
 * comparison, never a float comparison.
 */
function roundHalfEvenScaled(x: number, decimals: number): bigint {
  const { mantissa, exponent } = decompose(x);
  const pow10 = 10n ** BigInt(decimals);

  if (exponent >= 0) {
    // An integer multiple of a power of two: there is no fraction to round.
    return mantissa * (1n << BigInt(exponent)) * pow10;
  }

  const shift = BigInt(-exponent);
  const numerator = mantissa * pow10;
  const denominator = 1n << shift;
  const quotient = numerator >> shift;
  const remainder = numerator - (quotient << shift);

  const twiceRemainder = remainder * 2n;
  if (twiceRemainder > denominator) return quotient + 1n;
  if (twiceRemainder < denominator) return quotient;
  // Exact tie -> round to even.
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** Render a non-negative scaled BigInt as a fixed-point decimal string. */
function renderScaled(scaled: bigint, decimals: number): string {
  const digits = scaled.toString();
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

/**
 * Python f"{n:.Df}" / f"{n:,.Df}" / f"{n:+.Df}" equivalent.
 *
 * Rounds half-to-even on the exact value, matching Python rather than `toFixed`.
 * A negative value that rounds to zero keeps its sign, as Python does
 * (`f"{-0.004:.2f}"` is `"-0.00"`).
 */
export function fmtFixed(
  n: number,
  decimals: number,
  grouping = false,
  forceSign = false,
): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0 || Object.is(n, -0);
  let s = renderScaled(roundHalfEvenScaled(Math.abs(n), decimals), decimals);
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
  if (n === 0) return Object.is(n, -0) ? "-0" : "0";
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

/**
 * Python f"{shock:+.0%}" equivalent, e.g. 0.10 -> "+10%", -0.25 -> "-25%".
 *
 * Python's `%` presentation type multiplies by 100 and formats with `.0f`, which
 * rounds half-to-even; and it keeps the sign of a value that rounds to zero from
 * below, so `-0.004` renders `"-0%"`, not `"+0%"`. Both behaviours matter here
 * because this string is used as an object key.
 */
export function fmtSignedPct(shock: number): string {
  if (!Number.isFinite(shock)) return String(shock);
  const pct = shock * 100;
  const neg = pct < 0 || Object.is(pct, -0);
  const scaled = roundHalfEvenScaled(Math.abs(pct), 0);
  return `${neg ? "-" : "+"}${scaled.toString()}%`;
}

/**
 * Python round(x, 2) equivalent.
 *
 * Deliberately *not* `Math.round((n + Number.EPSILON) * 100) / 100`: that epsilon
 * nudge pushed exact ties the wrong way and made 4 of 7 sampled values disagree
 * with Python (e.g. `2.675` gave `2.68` where Python gives `2.67`).
 */
export function round2(n: number): number {
  return pyRound(n, 2);
}

/** Python round(x, decimals) equivalent, half-to-even on the exact value. */
export function pyRound(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return n;
  const neg = n < 0 || Object.is(n, -0);
  const magnitude = Number(roundHalfEvenScaled(Math.abs(n), decimals)) / 10 ** decimals;
  return neg ? -magnitude : magnitude;
}
