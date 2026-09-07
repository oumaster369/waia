"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { readPreparationAttemptV2 } from
  "@/lib/trader/historical-simulation-v2/preparation-attempt-events-v2";

const REQUEST_ACTION = "REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL";
const RATIFY_ACTION =
  "RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY";
const RELEASE_SHA = /^[0-9a-f]{40}$/;
type PreparationAttempt = NonNullable<Awaited<ReturnType<typeof readPreparationAttemptV2>>>;
const PREPARATION_PHASES: Readonly<Record<string, string>> = {
  SCIENTIFIC_PREPARATION: "Scientific preparation",
  SURFACE_LOAD: "Loading historical surface",
  FORECAST_ANCHORS: "Forecast anchors",
  VALIDATION_RESAMPLES: "Validation resamples",
  TECHNICAL_CANDIDATE_COMPLETE: "Technical candidate computation",
  PROPOSAL_PERSISTED: "Proposal persistence",
};
const PREPARATION_ERRORS: Readonly<Record<string, string>> = {
  CANCELLED: "The preparation attempt was cancelled.",
  CONNECTION_LOST: "The preparation attempt lost its database connection.",
  SCIENTIFIC_PREPARATION_REFUSED: "The scientific preparation checks refused this attempt.",
  PREPARATION_FAILED: "The preparation attempt failed; the operator must review its private diagnostic log.",
};
function safeLabel(labels: Readonly<Record<string, string>>, key: unknown) {
  return typeof key === "string" && Object.hasOwn(labels, key) ? labels[key] : undefined;
}
function observedCounter(value: unknown): string | null {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value))) return null;
  return String(value);
}
function PreparationAttemptDiagnostics({ attempt }: { attempt: PreparationAttempt }) {
  const valid = attempt.authorityGranted === false;
  const failed = valid && attempt.phase === "FAILED";
  const progressing = valid && (attempt.phase === "STARTED" || attempt.phase === "PROGRESS");
  const phase = safeLabel(PREPARATION_PHASES, attempt.progressPhase);
  const completed = observedCounter(attempt.completed), total = observedCounter(attempt.total);
  const countersValid = valid && attempt.phase === "PROGRESS" && phase && completed !== null &&
    total !== null && Number(total) > 0 && Number(completed) <= Number(total);
  const surface = typeof attempt.surfaceKey === "string" && /^(BTCUSDT|ETHUSDT):(30|60)$/.test(attempt.surfaceKey)
    ? attempt.surfaceKey : null;
  const trial = typeof attempt.trialIdentityDigestHex === "string" && /^[0-9a-f]{64}$/.test(attempt.trialIdentityDigestHex)
    ? attempt.trialIdentityDigestHex : null;
  const time = typeof attempt.observedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(attempt.observedAt) &&
    Number.isFinite(Date.parse(attempt.observedAt)) ? attempt.observedAt : null;
  return <section aria-label="Preparation attempt diagnostics" className="space-y-2 rounded-md border p-3 text-sm">
    {failed ? <p role="alert" className="text-destructive font-semibold">Preparation failed: {safeLabel(PREPARATION_ERRORS, attempt.errorCode) ??
      "The failure reason is unavailable; inspect the private diagnostic log."}</p> :
      <p className="font-semibold">{progressing ? "Preparation progress recorded" : "Preparation status unconfirmed"}</p>}
    {progressing ? <p className="text-muted-foreground">This is the last durable observation, not proof the process is still running.
      Current execution is unconfirmed until further evidence arrives.</p> : null}
    <p className="text-muted-foreground">Diagnostics do not grant launch or retry authority. A validated technical proposal
      and separate Human approval are still required.</p>
    {valid && phase ? <p>Last recorded stage: {phase}</p> : null}
    {valid && surface ? <p>Surface: {surface}</p> : null}
    {valid && trial ? <p className="break-all font-mono text-xs">Trial: {trial}</p> : null}
    {countersValid ? <p>Observed stage counter: {completed} / {total}.
      {" "}{surface ? "For the surface above" : "Surface scope unavailable"}; this is not overall preparation progress.</p> : null}
    <p className="text-muted-foreground text-xs">Last durable event: {time ? <time dateTime={time}>{time}</time> : "timestamp unavailable"}</p>
  </section>;
}

type Proposal = Readonly<{
  contentDigestHex: string;
  technicalCandidateContentDigestHex: string;
  requestContentDigestHex: string;
  technicalCandidate: Readonly<{
    qualificationReceiptDigestHex: string;
    firstEconomicRecordIndex: number;
    economicRecordCount: number;
    surfaces: readonly Readonly<{
      surfaceKey: string;
      familyIdentityDigestHex: string;
      predictivePackageGenerationIdentityDigestHex: string;
      predictivePackageContentDigestHex: string;
      kmGlobalAnchorSetDigestHex: string;
      volumeQualificationReceiptDigestHex: string;
    }>[];
  }>;
  launchPlan: Readonly<{
    accountId: string;
    symbol: string;
    primaryHorizonMinutes: number;
    startingCashUsdt: string;
    defaultQuantity: string;
    initialRecordIndex: number;
    cycleCount: number;
  }>;
  authorityBoundary: Readonly<{
    capitalAuthority: "NONE";
    liveTradingAuthority: "NONE";
    blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED";
  }>;
}>;

type Review = Readonly<{
  preparationState?: "NOT_REQUESTED" | "REQUEST_RECORDED" | "PROPOSAL_AVAILABLE";
  proposalAvailable: boolean;
  requestId?: string;
  requestedExtent?: Readonly<{ initialRecordIndex: number; cycleCount: number }>;
  proposalId?: string;
  proposal?: Proposal;
  ratified?: boolean;
  preparationAttempt?: PreparationAttempt | null;
}>;

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as
    { error?: { message?: string } } | null;
  return body?.error?.message ?? `Request failed (${response.status}).`;
}

export function HistoricalRatificationCeremonyV2({ organizationId, runId,
  initialReleaseSha = "" }: Readonly<{ organizationId: string; runId: string;
  initialReleaseSha?: string }>) {
  const [releaseSha, setReleaseSha] = React.useState(initialReleaseSha.toLowerCase());
  const [loaded, setLoaded] = React.useState<Readonly<{
    endpoint: string; review: Review; csrf: string;
  }> | null>(null);
  const [busy, setBusy] = React.useState(false);
  // The current qualified corpus has 525,600 WF_PREDICTIVE minutes.  The
  // observed run starts at the first later WF_ECONOMIC minute so the package
  // is never evaluated on evidence that was used to qualify it.
  const [initialRecordIndex, setInitialRecordIndex] = React.useState("525600");
  const [cycleCount, setCycleCount] = React.useState("35");
  const [error, setError] = React.useState<string | null>(null);
  const extentValid = /^\d+$/.test(initialRecordIndex) && Number(initialRecordIndex) >= 525_600 &&
    /^\d+$/.test(cycleCount) && Number(cycleCount) >= 1 && Number(cycleCount) <= 10_000;
  const valid = Boolean(organizationId && runId && RELEASE_SHA.test(releaseSha));
  const endpoint = valid ? "/api/trader/admin/historical-v2/ratification?" +
    new URLSearchParams({ organization_id: organizationId, run_id: runId,
      release_sha: releaseSha }).toString() : "";
  // A late response from another organization/run/release must never supply
  // the currently displayed review or its mutation token.
  const review = loaded?.endpoint === endpoint ? loaded.review : null;
  const csrf = loaded?.endpoint === endpoint ? loaded.csrf : "";
  const requestRecorded = review?.preparationState === "REQUEST_RECORDED";
  const refreshSequence = React.useRef(0);
  const settledRefreshSequence = React.useRef(0);

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    if (!endpoint) return null;
    const sequence = ++refreshSequence.current;
    try {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "include", signal });
    if (signal?.aborted || sequence < settledRefreshSequence.current) return null;
    const token = response.headers.get("x-fhv-csrf-token") ?? "";
    if (!response.ok) throw new Error(await responseMessage(response));
    const next = await response.json() as Review;
    if (signal?.aborted || sequence < settledRefreshSequence.current) return null;
    settledRefreshSequence.current = sequence;
    setLoaded({ endpoint, review: next, csrf: token });
    setError(null);
    return { review: next, csrf: token };
    } catch (cause) {
      if (signal?.aborted || sequence < settledRefreshSequence.current) return null;
      settledRefreshSequence.current = sequence;
      throw cause;
    }
  }, [endpoint]);

  React.useEffect(() => {
    if (!endpoint) return;
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      try { if (!stopped) await refresh(controller.signal); }
      catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message :
        "Ratification ceremony unavailable."); }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5_000);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); };
  }, [endpoint, refresh]);

  async function post(body: Record<string, string | number>) {
    if (!endpoint || busy) return;
    setBusy(true); setError(null);
    try {
      const context = csrf ? { csrf } : await refresh();
      const token = context?.csrf ?? "";
      if (!token) throw new Error("Authenticated CSRF ceremony could not be established.");
      const response = await fetch(endpoint, { method: "POST", credentials: "include",
        headers: { "content-type": "application/json", "x-fhv-csrf-token": token },
        body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await responseMessage(response));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ratification action failed.");
    } finally { setBusy(false); }
  }

  const proposal = review?.proposal;
  return <WaiaSurface variant="raised" className="space-y-4 p-5"
    data-testid="historical-ratification-ceremony-v2">
    <div><h2 className="text-lg font-semibold">Historical V2 launch ceremony</h2>
      <p className="text-muted-foreground mt-1 text-sm">Authenticated, two-step approval for one
        exact pre-holdout WALK_FORWARD run. It grants no private credentials, live trading,
        real-capital authority, or blind-holdout access.</p></div>
    <label className="block space-y-1 text-sm"><span className="font-medium">Exact release SHA</span>
      <input className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono text-sm"
        value={releaseSha} onChange={(event) => {
          setReleaseSha(event.target.value.trim().toLowerCase());
          setLoaded(null);
        }}
        placeholder="40-character Git SHA" maxLength={40}/></label>
    {!valid ? <p className="text-amber-300 text-sm">Enter the exact 40-character release SHA and a
      valid campaign run ID above.</p> : null}
    {valid && !review?.proposalAvailable && !requestRecorded ? <div className="grid max-w-xl gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span className="font-medium">Initial record index</span>
        <input className="border-border bg-background w-full rounded-md border px-3 py-2 font-mono"
          value={initialRecordIndex} onChange={(event) => setInitialRecordIndex(event.target.value)}
          inputMode="numeric" /></label>
      <label className="space-y-1 text-sm"><span className="font-medium">Cycle count</span>
        <input className="border-border bg-background w-full rounded-md border px-3 py-2 font-mono"
          value={cycleCount} onChange={(event) => setCycleCount(event.target.value)}
          inputMode="numeric" /></label>
    </div> : null}
    {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
    {valid && requestRecorded ? <div className="space-y-2" role="status">
      <p className="text-sm font-semibold">Preparation request recorded</p>
      <p className="text-muted-foreground text-sm">Your authenticated request is stored.
        The technical proposal is not available yet. This does not confirm that computation
        is running or that the historical test can start. This page checks automatically;
        no additional request click is needed.</p>
      <p className="text-muted-foreground text-xs">Request: {review.requestId}</p>
      {review.requestedExtent ? <p className="text-muted-foreground text-xs">
        Requested extent: initial record {review.requestedExtent.initialRecordIndex}
        {" · "}{review.requestedExtent.cycleCount} cycles</p> : null}
      {review.preparationAttempt ? <PreparationAttemptDiagnostics attempt={review.preparationAttempt}/> : null}
    </div> : null}
    {valid && !review?.proposalAvailable && !requestRecorded ? <div className="space-y-2">
      <p className="text-muted-foreground text-sm">No technical proposal exists yet. This action
        records your authenticated request; the execution host then prepares the exact evidence.</p>
      <Button type="button" disabled={busy || !extentValid || !review || Boolean(error)} onClick={() => post({
        action: REQUEST_ACTION, initial_record_index: Number(initialRecordIndex),
        cycle_count: Number(cycleCount),
      })}>
        {busy ? "Recording…" : "Request exact technical proposal"}</Button>
    </div> : null}
    {proposal && review?.proposalId ? <div className="space-y-4 rounded-md border border-cyan-400/30 p-4">
      <div><p className="text-sm font-semibold">Exact proposal ready for review</p>
        <p className="text-muted-foreground mt-1 text-xs">Approval is bound to the proposal digest,
          release, organization, run and authenticated operator.</p></div>
      <dl className="grid gap-3 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Proposal digest</dt><dd className="break-all font-mono">{proposal.contentDigestHex}</dd></div>
        <div><dt className="text-muted-foreground">Technical evidence digest</dt><dd className="break-all font-mono">{proposal.technicalCandidateContentDigestHex}</dd></div>
        <div><dt className="text-muted-foreground">Release SHA</dt><dd className="break-all font-mono">{releaseSha}</dd></div>
        <div><dt className="text-muted-foreground">Run</dt><dd className="break-all font-mono">{runId}</dd></div>
        <div><dt className="text-muted-foreground">Launch surface</dt><dd>{proposal.launchPlan.symbol} · {proposal.launchPlan.primaryHorizonMinutes}m · {proposal.launchPlan.accountId}</dd></div>
        <div><dt className="text-muted-foreground">Modeled capital</dt><dd>{proposal.launchPlan.startingCashUsdt} USDT · quantity {proposal.launchPlan.defaultQuantity}</dd></div>
        <div><dt className="text-muted-foreground">Approved extent</dt><dd>records {proposal.launchPlan.initialRecordIndex}–{proposal.launchPlan.initialRecordIndex + proposal.launchPlan.cycleCount - 1} · {proposal.launchPlan.cycleCount} cycles</dd></div>
      </dl>
      <div className="space-y-2 rounded border p-3 text-xs">
        <p className="font-semibold">Qualified evidence included in this approval</p>
        <p>Qualification receipt: <span className="break-all font-mono">{proposal.technicalCandidate.qualificationReceiptDigestHex}</span></p>
        <p>Qualified economic boundary: record {proposal.technicalCandidate.firstEconomicRecordIndex} · {proposal.technicalCandidate.economicRecordCount} available cycles</p>
        <div className="grid gap-2 lg:grid-cols-2">{proposal.technicalCandidate.surfaces.map(surface=><div key={surface.surfaceKey} className="rounded border p-2"><p className="font-semibold">{surface.surfaceKey}</p><p>Family: <span className="break-all font-mono">{surface.familyIdentityDigestHex}</span></p><p>Package: <span className="break-all font-mono">{surface.predictivePackageContentDigestHex}</span></p><p>Generation: <span className="break-all font-mono">{surface.predictivePackageGenerationIdentityDigestHex}</span></p><p>Convergence anchors: <span className="break-all font-mono">{surface.kmGlobalAnchorSetDigestHex}</span></p><p>Market volume authority: <span className="break-all font-mono">{surface.volumeQualificationReceiptDigestHex}</span></p></div>)}</div>
      </div>
      <div className="rounded border border-emerald-400/30 bg-emerald-400/5 p-3 text-xs">
        <div>Capital authority: <strong>{proposal.authorityBoundary.capitalAuthority}</strong></div>
        <div>Live trading authority: <strong>{proposal.authorityBoundary.liveTradingAuthority}</strong></div>
        <div>Blind holdout: <strong>{proposal.authorityBoundary.blindHoldoutAuthority}</strong></div>
      </div>
      {review.ratified ? <p className="text-emerald-300 text-sm font-medium">Exact proposal ratified.
        The execution host may now finalize, bootstrap, queue and consume this run.</p> :
        <Button type="button" disabled={busy} onClick={() => post({ action: RATIFY_ACTION,
          proposal_id: review.proposalId!,
          proposal_content_digest_hex: proposal.contentDigestHex })}>
          {busy ? "Ratifying…" : "Ratify this exact proposal"}</Button>}
    </div> : null}
  </WaiaSurface>;
}
