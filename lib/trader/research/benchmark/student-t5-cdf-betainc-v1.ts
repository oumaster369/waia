import { betaincLentzV1 } from "./betainc-lentz-v1";

export const STUDENT_T5_CDF_BETAINC_VERSION = "student-t5-cdf-betainc/v1" as const;

const NU = 5;
const A = NU / 2;
const B = 0.5;

/**
 * Standard Student-t CDF with ν=5, μ=0, scale s>0.
 */
export function studentT5CdfBetaincV1(x: number, s: number): number {
  if (!(s > 0) || !Number.isFinite(s) || !Number.isFinite(x)) {
    throw new Error(`[student-t5-cdf] invalid x=${x} s=${s}`);
  }
  const z = x / s;
  if (z === 0) {
    return 0.5;
  }
  const xBeta = NU / (NU + z * z);
  const i = betaincLentzV1(A, B, xBeta);
  if (z < 0) {
    return 0.5 * i;
  }
  return 1 - 0.5 * i;
}

/** Frozen baseline scale: s = sigma_dev * sqrt(3/5). */
export function studentT5BaselineScaleV1(sigmaDev: number): number {
  return sigmaDev * Math.sqrt(3 / 5);
}

/** Known-answer table from DEE-518 plan (s=1). */
export const STUDENT_T5_KNOWN_ANSWERS: ReadonlyArray<{ z: number; f: number }> = [
  { z: 0, f: 0.5 },
  { z: -0.5, f: 0.319149435820464622 },
  { z: 0.5, f: 0.680850564179535378 },
  { z: -1, f: 0.18160873382456199643 },
  { z: 1, f: 0.81839126617543800357 },
  { z: -2, f: 0.05096973941492919519 },
  { z: 2, f: 0.949030260585070784 },
  { z: -5, f: 0.00205235799002666036 },
  { z: 5, f: 0.9979476420099733236 },
];
