import assert from "node:assert/strict";

/** pytest.approx equivalent (relative tolerance 1e-6, tiny absolute floor). */
export function assertApprox(actual, expected, absTol) {
  const tol =
    absTol !== undefined ? absTol : Math.abs(expected) * 1e-6 + 1e-12;
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );
}
