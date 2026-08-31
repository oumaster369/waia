import { writeFhvPreHoldoutRuntimeRequalification } from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} required`);
  return value;
}

if (process.env.WAIA_TRADER_CLI === "1") {
  const receipt = writeFhvPreHoldoutRuntimeRequalification({
    datasetRoot: required("FHV_DATASET_ROOT"),
    sourceQualificationReceiptPath: required("FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH"),
    targetReleaseSha: required("FHV_RELEASE_SHA"),
    outputPath: required("FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH"),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
