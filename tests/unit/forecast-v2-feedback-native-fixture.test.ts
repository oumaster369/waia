import { describe, expect, it } from "vitest";
import { buildForecastFeedbackPackage, buildForecastFeedbackRuntimeInput } from
  "@/tests/helpers/forecast-v2-feedback-native-fixture";
import { issueForecastRuntimeV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { assignRvStateTertileV1, MIN_STATE_POOL_COUNT } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { type7QuantileV1 } from "@/lib/trader/research/benchmark/type7-quantile-v1";

const scientific = { id: "00000000-0000-4000-8000-000000111000", contentDigestHex: "a".repeat(64) };
const pit = "2024-01-01T00:00:00.000Z";
const org = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Synthetic compatibility input only. No scientific/source qualification is claimed.
describe("durable feedback synthetic Forecast fixture", () => {
  it.each([1, 84, 96])("issues a valid fixture for fixed tenant %s through the actual runtime", (n) => {
    const packageInput = buildForecastFeedbackPackage(org(n));
    const input = buildForecastFeedbackRuntimeInput(org(n), packageInput, pit, scientific);
    expect(input.marketStateSnapshot!.anchorRealizedVol20m_1m).toBe(0.010);
    expect(packageInput.kConfigDec).toBe(3);
    expect(packageInput.mConfigDec).toBe(4);
    expect(packageInput.canonicalSourceCorpus).toHaveLength(120);
    expect(new Set(packageInput.canonicalSourceCorpus.map((row) => row.realizedVol20m_1m)).size).toBe(12);
    expect(new Set(packageInput.canonicalSourceCorpus.map((row) => row.outcome13d[3])).size).toBe(7);
    for (const replica of packageInput.replicaArtifacts) {
      expect(replica.q1).toBeLessThan(replica.q2);
      expect(assignRvStateTertileV1(input.marketStateSnapshot!.anchorRealizedVol20m_1m, replica.q1, replica.q2)).toBe("S0");
      expect(replica.nS0).toBeGreaterThanOrEqual(40);
      expect(replica.nS0).toBeGreaterThanOrEqual(MIN_STATE_POOL_COUNT);
    }
    expect(issueForecastRuntimeV2(input).status).toBe("FORECAST_AUTHORIZED");
  });

  it("retains the demonstrated middle-pool refusal for fixed tenant84 and original anchor", () => {
    const packageInput = buildForecastFeedbackPackage(org(84));
    const input = buildForecastFeedbackRuntimeInput(org(84), packageInput, pit, scientific, 0.018);
    expect(packageInput.replicaArtifacts[1]!.nS1).toBe(29);
    expect(assignRvStateTertileV1(0.018, packageInput.replicaArtifacts[1]!.q1, packageInput.replicaArtifacts[1]!.q2)).toBe("S1");
    expect(issueForecastRuntimeV2(input)).toMatchObject({ status: "NON_ACTIONABLE",
      reason: "FORECAST_ISSUANCE_NON_ACTIONABLE", upstreamReasonCodes: ["FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT"] });
  });

  it("preserves exact package identities while the explicit anchor alone selects another input", () => {
    const packageInput = buildForecastFeedbackPackage(org(84));
    expect(packageInput.predictivePackageContentDigest.toString("hex")).toBe("f2c2909ee35b915f4ffe46e09d094157f7e9d932878441c5884fa03819480283");
    const input = buildForecastFeedbackRuntimeInput(org(84), packageInput, pit, scientific);
    const repeated = buildForecastFeedbackRuntimeInput(org(84), buildForecastFeedbackPackage(org(84)), pit, scientific);
    expect(issueForecastRuntimeV2(input)).toEqual(issueForecastRuntimeV2(repeated));
    expect(buildForecastFeedbackPackage(org(1)).predictivePackageContentDigest.equals(packageInput.predictivePackageContentDigest)).toBe(false);
    expect(input.forecastContractBinding!.organizationId).toBe(org(84));
  });

  it("proves the selected lower-tertile bound for every fixture RV boundary pair", () => {
    const values = [...new Set(buildForecastFeedbackPackage(org(84)).canonicalSourceCorpus.map((row) => row.realizedVol20m_1m))].sort((a, b) => a - b);
    let checked = 0;
    for (const lower of values) for (const upper of values.filter((value) => value >= lower)) {
      // Actual type7 q1 for n120 interpolates sorted indices39 and40. These
      // exhaust the fixture's finite possibilities, including equal/tied values.
      const sorted = [...Array<number>(40).fill(lower), ...Array<number>(80).fill(upper)];
      const q1 = type7QuantileV1(sorted, 1 / 3);
      expect(q1).toBeGreaterThanOrEqual(lower);
      expect(q1).toBeLessThanOrEqual(upper);
      expect(q1).toBeGreaterThanOrEqual(0.010);
      expect(sorted.filter((value) => value <= q1).length).toBeGreaterThanOrEqual(40);
      checked += 1;
    }
    expect(checked).toBe(78);
  });
});
