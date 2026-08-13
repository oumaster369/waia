import { ENERGY_MC_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";

export { ENERGY_MC_VERSION };

const EXEC_OPP_DIM = 13;

function l2(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * energy-mc/v1: MC_ES = (1/S)Σ||x_s-y||_2 - (1/(2J))Σ||x_{2j-1}-x_{2j}||_2
 * on normalized 13-D space; O(S·d).
 */
export function energyMcV1(input: {
  samples: readonly (readonly number[])[];
  reference: readonly number[];
}): number {
  const { samples, reference } = input;
  const s = samples.length;
  if (s === 0) {
    throw new Error("[energy-mc/v1] empty sample set");
  }
  if (reference.length !== EXEC_OPP_DIM) {
    throw new Error(`[energy-mc/v1] reference must be ${EXEC_OPP_DIM}-D`);
  }
  for (const sample of samples) {
    if (sample.length !== EXEC_OPP_DIM) {
      throw new Error(`[energy-mc/v1] sample must be ${EXEC_OPP_DIM}-D`);
    }
  }

  let term1 = 0;
  for (let i = 0; i < s; i += 1) {
    term1 += l2(samples[i]!, reference);
  }
  term1 /= s;

  const j = Math.floor(s / 2);
  let term2 = 0;
  for (let k = 0; k < j; k += 1) {
    term2 += l2(samples[2 * k]!, samples[2 * k + 1]!);
  }
  term2 /= 2 * j;

  return term1 - term2;
}

export function energyMcFromNestedCubeV1(
  cube: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  reference: readonly number[],
): number {
  const flat: number[][] = [];
  for (const row of cube) {
    for (const sample of row) {
      flat.push([...sample]);
    }
  }
  return energyMcV1({ samples: flat, reference });
}
