// Statistics for the A/B test (pure functions, used on the server and in the dashboard).
//
// Unit of analysis: one visitor. A visitor "converts" on a metric (clicked a suggestion,
// added one to the cart) at most once, so each group is a binomial sample and two groups are
// compared with the two-proportion z-test.

// Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7).
export function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const Z_95 = 1.959964;
const Z_POWER_80 = 0.841621;

/**
 * Two-proportion z-test of group B (treatment, AI) against group A (control).
 * x = visitors who converted, n = visitors in the group.
 * Returns rates, absolute difference with a 95% confidence interval, relative lift,
 * z and the two-sided p-value. Null when a group is empty.
 */
export function twoProportionZTest(xA, nA, xB, nB) {
  if (!nA || !nB) return null;
  const pA = xA / nA;
  const pB = xB / nB;
  const pooled = (xA + xB) / (nA + nB);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  const z = sePooled > 0 ? (pB - pA) / sePooled : 0;
  const pValue = sePooled > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  // Unpooled standard error for the confidence interval of the difference.
  const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const diff = pB - pA;
  return {
    pA,
    pB,
    diff,
    ci95: [diff - Z_95 * se, diff + Z_95 * se],
    lift: pA > 0 ? diff / pA : null,
    z,
    pValue,
    significant: pValue < 0.05,
  };
}

/**
 * Visitors needed in each group to detect the difference between rates pA and pB
 * (two-sided 5% significance, 80% power). Null when the rates are equal.
 */
export function sampleSizePerGroup(pA, pB) {
  const diff = pB - pA;
  if (!diff) return null;
  const variance = pA * (1 - pA) + pB * (1 - pB);
  return Math.ceil(((Z_95 + Z_POWER_80) ** 2 * variance) / (diff * diff));
}

// FNV-1a 32-bit hash: a stable visitor split without storing assignments.
export function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Group of a visitor: "control" (best sellers) or "ai" (trained rules).
 * The experiment start time salts the hash, so a new experiment reshuffles visitors.
 */
export function assignVariant(visitorId, experiment) {
  if (!experiment?.enabled || !visitorId) return "ai";
  const bucket = hash32(`${visitorId}:${experiment.startedAt ?? ""}`) % 100;
  return bucket < experiment.controlShare ? "control" : "ai";
}

// Seeded random numbers (mulberry32) so a replay run can be repeated exactly.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mean and sample variance of a list of numbers.
export function meanVariance(values) {
  const n = values.length;
  if (n === 0) return { n, mean: 0, variance: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, variance };
}

/**
 * Difference of two means (B minus A) with Welch's standard error and a normal approximation
 * (fine for hundreds of visitors per group). Used for revenue per visitor, which is not a
 * proportion. Returns the difference, its 95% interval, relative lift, z and p.
 */
export function meanDifferenceTest(a, b) {
  if (a.n < 2 || b.n < 2) return null;
  const diff = b.mean - a.mean;
  const se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  const z = se > 0 ? diff / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : 1;
  return {
    meanA: a.mean,
    meanB: b.mean,
    diff,
    ci95: [diff - Z_95 * se, diff + Z_95 * se],
    lift: a.mean > 0 ? diff / a.mean : null,
    z,
    pValue,
    significant: pValue < 0.05,
  };
}
