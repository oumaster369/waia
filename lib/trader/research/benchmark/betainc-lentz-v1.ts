/** Log-gamma for betainc front factor (Lanczos, sufficient for a,b > 0). */
function logGamma(z: number): number {
  if (z <= 0 || !Number.isFinite(z)) {
    return Number.NaN;
  }
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = coef[0]!;
  for (let i = 1; i < g + 2; i += 1) {
    x += coef[i]! / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export class BetaincDomainError extends Error {
  readonly code = "CDF_DOMAIN_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "BetaincDomainError";
  }
}

export class BetaincNonConvergentError extends Error {
  readonly code = "CDF_KERNEL_NON_CONVERGENT" as const;

  constructor(message: string) {
    super(message);
    this.name = "BetaincNonConvergentError";
  }
}

export class BetaincOverflowError extends Error {
  readonly code = "CDF_KERNEL_OVERFLOW" as const;

  constructor(message: string) {
    super(message);
    this.name = "BetaincOverflowError";
  }
}

export const BETAINC_LENTZ_VERSION = "betainc-lentz/v1" as const;

const MAX_ITER = 200;
const TOL = 1e-15;
const FPMIN = 1.0e-30;

function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) {
    d = FPMIN;
  }
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m += 1) {
    const m2 = 2 * m;

    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) {
      d = FPMIN;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) {
      c = FPMIN;
    }
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) {
      d = FPMIN;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) {
      c = FPMIN;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < TOL) {
      return h;
    }
  }

  throw new BetaincNonConvergentError("betacf did not converge");
}

/** Regularized incomplete beta I_x(a,b). */
export function betaincLentzV1(a: number, b: number, x: number): number {
  if (x < 0 || x > 1 || !Number.isFinite(x)) {
    throw new BetaincDomainError(`x out of domain: ${x}`);
  }
  if (a <= 0 || b <= 0 || !Number.isFinite(a) || !Number.isFinite(b)) {
    throw new BetaincDomainError(`invalid a or b: a=${a} b=${b}`);
  }
  if (x === 0) {
    return 0;
  }
  if (x === 1) {
    return 1;
  }

  const lnBt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (!Number.isFinite(lnBt)) {
    throw new BetaincOverflowError("bt front factor overflow/underflow");
  }
  const bt = Math.exp(lnBt);

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}
