/** Cody CALERF erf kernel (`cdf-erf-cody715/v1`, JINT=0). */
export const CDF_ERF_CODY715_VERSION = "cdf-erf-cody715/v1" as const;

const FOUR = 4.0;
const ONE = 1.0;
const HALF = 0.5;
const TWO = 2.0;
const SQRPI = 0.56418958354775628695;
const THRESH = 0.46875;
const SIXTEN = 16.0;
const XBIG = 26.543;
const XHUGE = 6.71e7;
const XMAX = 2.53e307;
const XSMALL = 1.11e-16;

const A = [
  0, 3.1611237438705656, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3,
  1.85777706184603153e-1,
];
const B = [
  0, 2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3,
];
const C = [
  0, 5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2,
  8.8195222124176909e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
  2.15311535474403846e-8,
];
const D = [
  0, 1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
  3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3,
];
const P = [
  0, 3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2,
  6.58749161529837803e-4, 1.63153871373020978e-2,
];
const Q = [
  0, 2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1, 6.05183413124413191e-2,
  2.33520497626869185e-3,
];

function fixupErfFromErfc(x: number, erfc: number): number {
  let result = HALF - erfc + HALF;
  if (x < 0) {
    result = -result;
  }
  return result;
}

/** erf(x) via Cody CALERF JINT=0 path. */
export function erfCody715V1(x: number): number {
  const absY = Math.abs(x);

  if (absY <= THRESH) {
    let ysq = 0;
    if (absY > XSMALL) {
      ysq = x * x;
    }
    let xnum = A[5]! * ysq;
    let xden = ysq;
    for (let i = 1; i <= 3; i += 1) {
      xnum = (xnum + A[i]!) * ysq;
      xden = (xden + B[i]!) * ysq;
    }
    return x * ((xnum + A[4]!) / (xden + B[4]!));
  }

  if (absY <= FOUR) {
    let xnum = C[9]! * absY;
    let xden = absY;
    for (let i = 1; i <= 7; i += 1) {
      xnum = (xnum + C[i]!) * absY;
      xden = (xden + D[i]!) * absY;
    }
    let result = (xnum + C[8]!) / (xden + D[8]!);
    const ysq = Math.floor(absY * SIXTEN) / SIXTEN;
    const del = (absY - ysq) * (absY + ysq);
    result = Math.exp(-ysq * ysq) * Math.exp(-del) * result;
    return fixupErfFromErfc(x, result);
  }

  let result = 0;
  if (absY >= XBIG) {
    if (absY >= XMAX) {
      return fixupErfFromErfc(x, 0);
    }
    if (absY >= XHUGE) {
      result = SQRPI / absY;
      return fixupErfFromErfc(x, result);
    }
  }
  const ysqInv = 1 / (absY * absY);
  let xnum = P[6]! * ysqInv;
  let xden = ysqInv;
  for (let i = 1; i <= 4; i += 1) {
    xnum = (xnum + P[i]!) * ysqInv;
    xden = (xden + Q[i]!) * ysqInv;
  }
  result = ysqInv * ((xnum + P[5]!) / (xden + Q[5]!));
  result = (SQRPI - result) / absY;
  const ysq = Math.floor(absY * SIXTEN) / SIXTEN;
  const del = (absY - ysq) * (absY + ysq);
  result = Math.exp(-ysq * ysq) * Math.exp(-del) * result;
  return fixupErfFromErfc(x, result);
}

const SQRT2 = Math.SQRT2;

export function normalCdfCody715V1(z: number): number {
  return HALF * (ONE + erfCody715V1(z / SQRT2));
}
