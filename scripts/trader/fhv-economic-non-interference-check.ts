import { runFhvEconomicNonInterferenceQualification } from "@/lib/trader/observability/fhv-economic-non-interference-harness";

async function main() {
  const result = await runFhvEconomicNonInterferenceQualification();
  console.log(JSON.stringify(result, null, 2));
}

void main();
