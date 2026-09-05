"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";

const REQUEST_ACTION = "REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL";
const RATIFY_ACTION =
  "RATIFY_FOUR_SURFACE_WF_PREDICTIVE_FOR_HISTORICAL_SIMULATION_ONLY";
const RELEASE_SHA = /^[0-9a-f]{40}$/;

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
  proposalAvailable: boolean;
  proposalId?: string;
  proposal?: Proposal;
  ratified?: boolean;
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
  const [review, setReview] = React.useState<Review | null>(null);
  const [csrf, setCsrf] = React.useState("");
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

  const refresh = React.useCallback(async () => {
    if (!endpoint) return null;
    const response = await fetch(endpoint, { cache: "no-store", credentials: "include" });
    const token = response.headers.get("x-fhv-csrf-token") ?? "";
    if (!response.ok) throw new Error(await responseMessage(response));
    const next = await response.json() as Review;
    setReview(next);
    if (token) setCsrf(token);
    setError(null);
    return { review: next, csrf: token };
  }, [endpoint]);

  React.useEffect(() => {
    if (!endpoint) return;
    let stopped = false;
    const poll = async () => {
      try { if (!stopped) await refresh(); }
      catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message :
        "Ratification ceremony unavailable."); }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5_000);
    return () => { stopped = true; window.clearInterval(timer); };
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
          setReview(null);
          setCsrf("");
        }}
        placeholder="40-character Git SHA" maxLength={40}/></label>
    {!valid ? <p className="text-amber-300 text-sm">Enter the exact 40-character release SHA and a
      valid campaign run ID above.</p> : null}
    {valid && !review?.proposalAvailable ? <div className="grid max-w-xl gap-3 sm:grid-cols-2">
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
    {valid && !review?.proposalAvailable ? <div className="space-y-2">
      <p className="text-muted-foreground text-sm">No technical proposal exists yet. This action
        records your authenticated request; the execution host then prepares the exact evidence.</p>
      <Button type="button" disabled={busy || !extentValid} onClick={() => post({
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
