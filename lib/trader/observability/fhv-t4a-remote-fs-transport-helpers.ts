/**
 * DEE-436 — helpers building remote FS operations from operator context.
 */

import type { FhvT4aExecContext } from "@/lib/trader/observability/fhv-t4a-operator-executor";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  buildDefaultRemoteFsOperation,
  type FhvT4aRemoteFsExistsOperation,
  type FhvT4aRemoteFsPrivilegeLocus,
  type FhvT4aRemoteFsReadOperation,
  type FhvT4aRemoteFsSha256Operation,
} from "@/lib/trader/observability/fhv-t4a-remote-fs-ops";

function remoteFsBase(ctx: FhvT4aExecContext, locus: FhvT4aRemoteFsPrivilegeLocus = "REMOTE_ROOT") {
  return {
    approvedRoots: ctx.transport.approvedRemoteRoots,
    pythonBin: ctx.bindings.pythonBin,
    serviceUser: ctx.bindings.serviceUser,
    locus,
  };
}

function transportRemoteFsBase(
  transport: FhvT4aOperatorTransport,
  bindings: FhvT4aOperatorBindings,
  locus: FhvT4aRemoteFsPrivilegeLocus = "REMOTE_ROOT",
) {
  return {
    approvedRoots: transport.approvedRemoteRoots,
    pythonBin: bindings.pythonBin,
    serviceUser: bindings.serviceUser,
    locus,
  };
}

export function buildFhvT4aRemoteFsExistsOp(
  ctx: FhvT4aExecContext,
  remotePath: string,
  locus?: FhvT4aRemoteFsPrivilegeLocus,
): FhvT4aRemoteFsExistsOperation {
  return buildDefaultRemoteFsOperation({
    ...remoteFsBase(ctx, locus),
    remotePath,
  });
}

export function buildFhvT4aRemoteFsReadOp(
  ctx: FhvT4aExecContext,
  remotePath: string,
  locus?: FhvT4aRemoteFsPrivilegeLocus,
): FhvT4aRemoteFsReadOperation {
  return buildDefaultRemoteFsOperation({
    ...remoteFsBase(ctx, locus),
    remotePath,
    byteCap: ctx.transport.remoteReadByteCap,
  });
}

export function buildFhvT4aRemoteFsSha256Op(
  ctx: FhvT4aExecContext,
  remotePath: string,
  locus?: FhvT4aRemoteFsPrivilegeLocus,
): FhvT4aRemoteFsSha256Operation {
  return buildDefaultRemoteFsOperation({
    ...remoteFsBase(ctx, locus),
    remotePath,
  });
}

export type FhvT4aRemoteFsMode = "exists" | "read" | "sha256";

/** Build a remote FS operation from operator context, path, and mode. */
export function buildRemoteFsOp(
  ctx: FhvT4aExecContext,
  remotePath: string,
  mode: FhvT4aRemoteFsMode,
  locus?: FhvT4aRemoteFsPrivilegeLocus,
): FhvT4aRemoteFsExistsOperation | FhvT4aRemoteFsReadOperation | FhvT4aRemoteFsSha256Operation {
  switch (mode) {
    case "exists":
      return buildFhvT4aRemoteFsExistsOp(ctx, remotePath, locus);
    case "read":
      return buildFhvT4aRemoteFsReadOp(ctx, remotePath, locus);
    case "sha256":
      return buildFhvT4aRemoteFsSha256Op(ctx, remotePath, locus);
  }
}

export function buildFhvT4aRemoteFsOpFromTransport(input: {
  transport: FhvT4aOperatorTransport;
  bindings: FhvT4aOperatorBindings;
  remotePath: string;
  mode: "exists";
  locus?: FhvT4aRemoteFsPrivilegeLocus;
}): FhvT4aRemoteFsExistsOperation;
export function buildFhvT4aRemoteFsOpFromTransport(input: {
  transport: FhvT4aOperatorTransport;
  bindings: FhvT4aOperatorBindings;
  remotePath: string;
  mode: "read";
  locus?: FhvT4aRemoteFsPrivilegeLocus;
}): FhvT4aRemoteFsReadOperation;
export function buildFhvT4aRemoteFsOpFromTransport(input: {
  transport: FhvT4aOperatorTransport;
  bindings: FhvT4aOperatorBindings;
  remotePath: string;
  mode: "sha256";
  locus?: FhvT4aRemoteFsPrivilegeLocus;
}): FhvT4aRemoteFsSha256Operation;
export function buildFhvT4aRemoteFsOpFromTransport(input: {
  transport: FhvT4aOperatorTransport;
  bindings: FhvT4aOperatorBindings;
  remotePath: string;
  mode: FhvT4aRemoteFsMode;
  locus?: FhvT4aRemoteFsPrivilegeLocus;
}): FhvT4aRemoteFsExistsOperation | FhvT4aRemoteFsReadOperation | FhvT4aRemoteFsSha256Operation {
  const base = {
    ...transportRemoteFsBase(input.transport, input.bindings, input.locus),
    remotePath: input.remotePath,
  };
  switch (input.mode) {
    case "exists":
      return buildDefaultRemoteFsOperation(base);
    case "read":
      return buildDefaultRemoteFsOperation({
        ...base,
        byteCap: input.transport.remoteReadByteCap,
      });
    case "sha256":
      return buildDefaultRemoteFsOperation(base);
  }
}
