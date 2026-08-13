import { createHash } from "node:crypto";

import type postgres from "postgres";

import {
  A3_PACKAGE_CELLS,
  computeA3PackageSurfaceSemanticDigestHex,
} from "./a3-storage-contract-v1";
import {
  FORECAST_V2_K_MAX,
  FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
  FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES,
} from "./storage-scale-projection";

export const A3_CANONICAL_PACKAGE_CELL_COUNTS = {
  predictivePackages: 1,
  targetDefinitions: 2,
  terminalBuckets: 7,
  executionOpportunityBuckets: 0,
  packageTargetBindings: 2,
  replicaArtifacts: 50,
} as const;

export const A3_CANONICAL_PACKAGE_TOTAL_COUNTS = {
  predictivePackages: 4,
  targetDefinitions: 8,
  terminalBuckets: 28,
  executionOpportunityBuckets: 0,
  packageTargetBindings: 8,
  replicaArtifacts: 200,
  rawReplicaPayloadBytes: 200 * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
} as const;

export type A3ObservedPackageCellProofV1 = {
  symbol: string;
  horizonMinutes: number;
  predictivePackages: number;
  targetDefinitions: number;
  terminalBuckets: number;
  executionOpportunityBuckets: number;
  packageTargetBindings: number;
  replicaArtifacts: number;
  replicaPayloadBytesTotal: number;
  replicas: readonly {
    replicaOrdinal: number;
    payloadLengthBytes: number;
    payloadSha256Hex: string;
  }[];
  targetDefinitionsByRole: readonly {
    targetRoleId: string;
    representationKind: string;
    count: number;
  }[];
};

export type A3ObservedPackageSurfaceProofV1 = {
  schemaVersion: "a3-observed-package-surface/v1";
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurfaceDigestHex: string;
  observedPackageContractConforms: boolean;
  failureReasons: string[];
  totals: {
    predictivePackages: number;
    targetDefinitions: number;
    terminalBuckets: number;
    executionOpportunityBuckets: number;
    packageTargetBindings: number;
    replicaArtifacts: number;
    rawReplicaPayloadBytes: number;
  };
  cells: readonly A3ObservedPackageCellProofV1[];
};

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function sha256Buffer(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function cellKey(symbol: string, horizonMinutes: number): string {
  return `${symbol}/${horizonMinutes}`;
}

function buildNormalizedObservedDigestLines(proof: {
  cells: readonly A3ObservedPackageCellProofV1[];
  totals: A3ObservedPackageSurfaceProofV1["totals"];
}): string[] {
  const lines = [
    "a3-observed-package-surface/v1",
    `totals_packages=${proof.totals.predictivePackages}`,
    `totals_target_definitions=${proof.totals.targetDefinitions}`,
    `totals_terminal_buckets=${proof.totals.terminalBuckets}`,
    `totals_eo_buckets=${proof.totals.executionOpportunityBuckets}`,
    `totals_bindings=${proof.totals.packageTargetBindings}`,
    `totals_replicas=${proof.totals.replicaArtifacts}`,
    `totals_raw_payload_bytes=${proof.totals.rawReplicaPayloadBytes}`,
  ];

  const orderedCells = [...proof.cells].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.horizonMinutes - b.horizonMinutes,
  );

  for (const cell of orderedCells) {
    lines.push(`cell=${cellKey(cell.symbol, cell.horizonMinutes)}`);
    lines.push(`cell_packages=${cell.predictivePackages}`);
    lines.push(`cell_target_definitions=${cell.targetDefinitions}`);
    lines.push(`cell_terminal_buckets=${cell.terminalBuckets}`);
    lines.push(`cell_eo_buckets=${cell.executionOpportunityBuckets}`);
    lines.push(`cell_bindings=${cell.packageTargetBindings}`);
    lines.push(`cell_replicas=${cell.replicaArtifacts}`);
    lines.push(`cell_raw_payload_bytes=${cell.replicaPayloadBytesTotal}`);

    for (const target of [...cell.targetDefinitionsByRole].sort((a, b) =>
      a.targetRoleId.localeCompare(b.targetRoleId),
    )) {
      lines.push(
        `cell_target=${cellKey(cell.symbol, cell.horizonMinutes)};role=${target.targetRoleId};representation=${target.representationKind};count=${target.count}`,
      );
    }

    for (const replica of [...cell.replicas].sort((a, b) => a.replicaOrdinal - b.replicaOrdinal)) {
      lines.push(
        `cell_replica=${cellKey(cell.symbol, cell.horizonMinutes)};ordinal=${replica.replicaOrdinal};len=${replica.payloadLengthBytes};sha256=${replica.payloadSha256Hex}`,
      );
    }
  }

  return lines;
}

export function computeObservedPackageSurfaceDigestHex(input: {
  cells: readonly A3ObservedPackageCellProofV1[];
  totals: A3ObservedPackageSurfaceProofV1["totals"];
}): string {
  return sha256Hex(buildNormalizedObservedDigestLines(input).join("\n"));
}

export async function queryObservedPackageSurfaceProof(
  sql: postgres.Sql,
  organizationId: string,
): Promise<A3ObservedPackageSurfaceProofV1> {
  const failureReasons: string[] = [];
  const expectedPackageSurfaceDigestHex = computeA3PackageSurfaceSemanticDigestHex();

  const packageRows = await sql<
    {
      symbol: string;
      primary_horizon_minutes: number;
      count: string;
    }[]
  >`
    SELECT symbol, primary_horizon_minutes, count(*)::text AS count
    FROM trader_forecast_predictive_package_v2
    WHERE organization_id = ${organizationId}::uuid
    GROUP BY symbol, primary_horizon_minutes
    ORDER BY symbol, primary_horizon_minutes
  `;

  const unexpectedCells = packageRows.filter(
    (row) =>
      !A3_PACKAGE_CELLS.some(
        (cell) => cell.symbol === row.symbol && cell.horizonMinutes === row.primary_horizon_minutes,
      ),
  );
  if (unexpectedCells.length > 0) {
    failureReasons.push(
      `unexpected package cells: ${unexpectedCells.map((row) => cellKey(row.symbol, row.primary_horizon_minutes)).join(",")}`,
    );
  }

  for (const cell of A3_PACKAGE_CELLS) {
    const row = packageRows.find(
      (candidate) =>
        candidate.symbol === cell.symbol &&
        candidate.primary_horizon_minutes === cell.horizonMinutes,
    );
    if (!row) {
      failureReasons.push(`missing package cell ${cellKey(cell.symbol, cell.horizonMinutes)}`);
    } else if (Number(row.count) !== A3_CANONICAL_PACKAGE_CELL_COUNTS.predictivePackages) {
      failureReasons.push(
        `cell ${cellKey(cell.symbol, cell.horizonMinutes)} packages expected 1 got ${row.count}`,
      );
    }
  }

  const targetRows = await sql<
    {
      symbol: string;
      primary_horizon_minutes: number;
      target_role_id: string;
      representation_kind: string;
      count: string;
    }[]
  >`
    SELECT symbol, primary_horizon_minutes, target_role_id, representation_kind, count(*)::text AS count
    FROM trader_forecast_target_definition_v2
    WHERE organization_id = ${organizationId}::uuid
    GROUP BY symbol, primary_horizon_minutes, target_role_id, representation_kind
    ORDER BY symbol, primary_horizon_minutes, target_role_id
  `;

  const bucketRows = await sql<
    {
      symbol: string;
      primary_horizon_minutes: number;
      target_role_id: string;
      count: string;
    }[]
  >`
    SELECT td.symbol, td.primary_horizon_minutes, td.target_role_id, count(*)::text AS count
    FROM trader_forecast_target_bucket_v2 tb
    JOIN trader_forecast_target_definition_v2 td
      ON td.id = tb.target_definition_id AND td.organization_id = tb.organization_id
    WHERE tb.organization_id = ${organizationId}::uuid
    GROUP BY td.symbol, td.primary_horizon_minutes, td.target_role_id
    ORDER BY td.symbol, td.primary_horizon_minutes, td.target_role_id
  `;

  const bindingRows = await sql<
    {
      symbol: string;
      primary_horizon_minutes: number;
      target_role_id: string;
      count: string;
    }[]
  >`
    SELECT p.symbol, p.primary_horizon_minutes, pt.target_role_id, count(*)::text AS count
    FROM trader_forecast_predictive_package_target_v2 pt
    JOIN trader_forecast_predictive_package_v2 p
      ON p.id = pt.predictive_package_id AND p.organization_id = pt.organization_id
    WHERE pt.organization_id = ${organizationId}::uuid
    GROUP BY p.symbol, p.primary_horizon_minutes, pt.target_role_id
    ORDER BY p.symbol, p.primary_horizon_minutes, pt.target_role_id
  `;

  const replicaRows = await sql<
    {
      symbol: string;
      primary_horizon_minutes: number;
      replica_ordinal: number;
      payload_length: string;
      artifact_payload: Buffer;
    }[]
  >`
    SELECT
      p.symbol,
      p.primary_horizon_minutes,
      ra.replica_ordinal,
      octet_length(ra.artifact_payload)::text AS payload_length,
      ra.artifact_payload
    FROM trader_forecast_replica_artifact_v2 ra
    JOIN trader_forecast_predictive_package_v2 p
      ON p.id = ra.predictive_package_id AND p.organization_id = ra.organization_id
    WHERE ra.organization_id = ${organizationId}::uuid
    ORDER BY p.symbol, p.primary_horizon_minutes, ra.replica_ordinal
  `;

  const cells: A3ObservedPackageCellProofV1[] = [];

  for (const cell of A3_PACKAGE_CELLS) {
    const key = cellKey(cell.symbol, cell.horizonMinutes);
    const predictivePackages = Number(
      packageRows.find(
        (row) => row.symbol === cell.symbol && row.primary_horizon_minutes === cell.horizonMinutes,
      )?.count ?? 0,
    );

    const targetDefinitionsByRole = targetRows
      .filter(
        (row) => row.symbol === cell.symbol && row.primary_horizon_minutes === cell.horizonMinutes,
      )
      .map((row) => ({
        targetRoleId: row.target_role_id,
        representationKind: row.representation_kind,
        count: Number(row.count),
      }));

    const targetDefinitions = targetDefinitionsByRole.reduce((acc, row) => acc + row.count, 0);
    const terminalBuckets = Number(
      bucketRows.find(
        (row) =>
          row.symbol === cell.symbol &&
          row.primary_horizon_minutes === cell.horizonMinutes &&
          row.target_role_id === "TERMINAL_RETURN",
      )?.count ?? 0,
    );
    const executionOpportunityBuckets = Number(
      bucketRows.find(
        (row) =>
          row.symbol === cell.symbol &&
          row.primary_horizon_minutes === cell.horizonMinutes &&
          row.target_role_id === "EXECUTION_OPPORTUNITY",
      )?.count ?? 0,
    );
    const packageTargetBindings = bindingRows
      .filter(
        (row) => row.symbol === cell.symbol && row.primary_horizon_minutes === cell.horizonMinutes,
      )
      .reduce((acc, row) => acc + Number(row.count), 0);

    const replicas = replicaRows
      .filter(
        (row) => row.symbol === cell.symbol && row.primary_horizon_minutes === cell.horizonMinutes,
      )
      .map((row) => ({
        replicaOrdinal: row.replica_ordinal,
        payloadLengthBytes: Number(row.payload_length),
        payloadSha256Hex: sha256Buffer(Buffer.from(row.artifact_payload)),
      }));

    const replicaArtifacts = replicas.length;
    const replicaPayloadBytesTotal = replicas.reduce((acc, row) => acc + row.payloadLengthBytes, 0);

    if (predictivePackages !== A3_CANONICAL_PACKAGE_CELL_COUNTS.predictivePackages) {
      failureReasons.push(`${key} packages=${predictivePackages} expected 1`);
    }
    if (targetDefinitions !== A3_CANONICAL_PACKAGE_CELL_COUNTS.targetDefinitions) {
      failureReasons.push(`${key} target_definitions=${targetDefinitions} expected 2`);
    }
    if (terminalBuckets !== A3_CANONICAL_PACKAGE_CELL_COUNTS.terminalBuckets) {
      failureReasons.push(`${key} terminal_buckets=${terminalBuckets} expected 7`);
    }
    if (
      executionOpportunityBuckets !== A3_CANONICAL_PACKAGE_CELL_COUNTS.executionOpportunityBuckets
    ) {
      failureReasons.push(`${key} eo_buckets=${executionOpportunityBuckets} expected 0`);
    }
    if (packageTargetBindings !== A3_CANONICAL_PACKAGE_CELL_COUNTS.packageTargetBindings) {
      failureReasons.push(`${key} bindings=${packageTargetBindings} expected 2`);
    }
    if (replicaArtifacts !== A3_CANONICAL_PACKAGE_CELL_COUNTS.replicaArtifacts) {
      failureReasons.push(`${key} replicas=${replicaArtifacts} expected 50`);
    }

    const ordinals = replicas.map((row) => row.replicaOrdinal).sort((a, b) => a - b);
    for (let ordinal = 0; ordinal < FORECAST_V2_K_MAX; ordinal += 1) {
      if (ordinals[ordinal] !== ordinal) {
        failureReasons.push(`${key} missing or duplicate replica ordinal ${ordinal}`);
        break;
      }
    }

    for (const replica of replicas) {
      if (replica.payloadLengthBytes !== FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES) {
        failureReasons.push(
          `${key} replica ${replica.replicaOrdinal} payload length ${replica.payloadLengthBytes} != ${FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES}`,
        );
      }
    }

    if (
      replicaPayloadBytesTotal !==
      A3_CANONICAL_PACKAGE_CELL_COUNTS.replicaArtifacts * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES
    ) {
      failureReasons.push(`${key} raw payload bytes=${replicaPayloadBytesTotal} unexpected`);
    }

    cells.push({
      symbol: cell.symbol,
      horizonMinutes: cell.horizonMinutes,
      predictivePackages,
      targetDefinitions,
      terminalBuckets,
      executionOpportunityBuckets,
      packageTargetBindings,
      replicaArtifacts,
      replicaPayloadBytesTotal,
      replicas,
      targetDefinitionsByRole,
    });
  }

  const totals = {
    predictivePackages: cells.reduce((acc, cell) => acc + cell.predictivePackages, 0),
    targetDefinitions: cells.reduce((acc, cell) => acc + cell.targetDefinitions, 0),
    terminalBuckets: cells.reduce((acc, cell) => acc + cell.terminalBuckets, 0),
    executionOpportunityBuckets: cells.reduce(
      (acc, cell) => acc + cell.executionOpportunityBuckets,
      0,
    ),
    packageTargetBindings: cells.reduce((acc, cell) => acc + cell.packageTargetBindings, 0),
    replicaArtifacts: cells.reduce((acc, cell) => acc + cell.replicaArtifacts, 0),
    rawReplicaPayloadBytes: cells.reduce((acc, cell) => acc + cell.replicaPayloadBytesTotal, 0),
  };

  if (totals.predictivePackages !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.predictivePackages) {
    failureReasons.push(`total packages=${totals.predictivePackages} expected 4`);
  }
  if (totals.targetDefinitions !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.targetDefinitions) {
    failureReasons.push(`total target_definitions=${totals.targetDefinitions} expected 8`);
  }
  if (totals.terminalBuckets !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.terminalBuckets) {
    failureReasons.push(`total terminal_buckets=${totals.terminalBuckets} expected 28`);
  }
  if (
    totals.executionOpportunityBuckets !==
    A3_CANONICAL_PACKAGE_TOTAL_COUNTS.executionOpportunityBuckets
  ) {
    failureReasons.push(`total eo_buckets=${totals.executionOpportunityBuckets} expected 0`);
  }
  if (totals.packageTargetBindings !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.packageTargetBindings) {
    failureReasons.push(`total bindings=${totals.packageTargetBindings} expected 8`);
  }
  if (totals.replicaArtifacts !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.replicaArtifacts) {
    failureReasons.push(`total replicas=${totals.replicaArtifacts} expected 200`);
  }
  if (totals.rawReplicaPayloadBytes !== A3_CANONICAL_PACKAGE_TOTAL_COUNTS.rawReplicaPayloadBytes) {
    failureReasons.push(
      `total raw payload bytes=${totals.rawReplicaPayloadBytes} expected ${A3_CANONICAL_PACKAGE_TOTAL_COUNTS.rawReplicaPayloadBytes}`,
    );
  }
  if (totals.rawReplicaPayloadBytes !== FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES * 4) {
    failureReasons.push("total raw payload bytes mismatch package replica payload constant");
  }

  const observedPackageSurfaceDigestHex = computeObservedPackageSurfaceDigestHex({
    cells,
    totals,
  });

  return {
    schemaVersion: "a3-observed-package-surface/v1",
    expectedPackageSurfaceDigestHex,
    observedPackageSurfaceDigestHex,
    observedPackageContractConforms: failureReasons.length === 0,
    failureReasons,
    totals,
    cells,
  };
}

export function assertObservedPackageSurfaceProof(proof: A3ObservedPackageSurfaceProofV1): void {
  if (!proof.observedPackageContractConforms) {
    throw new Error(
      `[a3-observed-package] contract non-conformance: ${proof.failureReasons.join("; ")}`,
    );
  }
}

export function digestReplicaPayloadForTest(payload: Buffer): string {
  return sha256Buffer(payload);
}
