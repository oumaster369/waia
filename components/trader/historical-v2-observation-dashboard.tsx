"use client";
import * as React from "react";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const POLL_MS=2_000;
const scalar=(value:unknown)=>typeof value==="string"||typeof value==="number"?String(value):"—";
const reasons=(value:unknown):string=>{
  if(!value||typeof value!=="object")return "—";
  const v=value as Record<string,unknown>;const raw=v.reasonCodes??v.reasons;
  return Array.isArray(raw)?raw.map(String).join(", "):scalar(v.reason??v.status??v.verdict);
};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function Card({title,value,detail}:{title:string;value:React.ReactNode;detail?:React.ReactNode}){
  return <WaiaSurface variant="raised" className="p-4"><p className="text-muted-foreground text-xs uppercase">{title}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>{detail?<div className="text-muted-foreground mt-2 text-xs">{detail}</div>:null}</WaiaSurface>;
}
export function HistoricalV2ObservationDashboard({endpoint,runId,accountId,expectedOrganizationId}:{endpoint:string;runId:string;accountId?:string;expectedOrganizationId?:string}){
  const [projection,setProjection]=React.useState<HistoricalObservableProjectionV2|null>(null);
  const [connected,setConnected]=React.useState(false);const [error,setError]=React.useState<string|null>(null);
  React.useEffect(()=>{
    let stopped=false,refused=false,polling=false,inFlight=false,source:EventSource|null=null,timer:number|undefined;
    const refuse=(message:string)=>{if(stopped||refused)return;refused=true;setConnected(false);setError(message);source?.close();source=null;if(timer!==undefined){window.clearTimeout(timer);timer=undefined;}};
    const accept=(next:HistoricalObservableProjectionV2)=>{if(stopped||refused)return;if(next.runId!==runId||next.mode!=="HISTORICAL_SIMULATION"||next.capitalEligible!==false||(expectedOrganizationId!==undefined&&next.organizationId!==expectedOrganizationId)){refuse("Historical stream identity mismatch. Connection closed safely.");return;}if(accountId&&(next.accounts.length>1||next.accounts.some(a=>a.accountId!==accountId))){refuse("Account scope mismatch. Connection closed safely.");return;}setProjection(next);setConnected(true);setError(null);};
    const poll=async()=>{if(stopped||refused||inFlight)return;inFlight=true;try{const separator=endpoint.includes("?")?"&":"?";const response=await fetch(`${endpoint}${separator}transport=poll`,{cache:"no-store",credentials:"include"});if(!response.ok)throw new Error("Historical projection unavailable");accept(await response.json() as HistoricalObservableProjectionV2);}catch{if(!stopped&&!refused){setConnected(false);setError("Stream interrupted. Reconnecting automatically…");}}finally{inFlight=false;if(!stopped&&!refused&&polling)timer=window.setTimeout(poll,POLL_MS);}};
    const startPolling=()=>{if(stopped||refused||polling)return;polling=true;void poll();};
    if(typeof EventSource==="function"){
      source=new EventSource(endpoint,{withCredentials:true});source.onopen=()=>setConnected(true);
      source.addEventListener("historical.snapshot",raw=>{try{accept(JSON.parse((raw as MessageEvent<string>).data) as HistoricalObservableProjectionV2);}catch{setError("Invalid historical event rejected.");}});
      source.onerror=()=>{if(stopped||refused)return;setConnected(false);setError("Stream interrupted. Polling automatically…");source?.close();source=null;startPolling();};
    }else startPolling();
    return()=>{stopped=true;source?.close();if(timer)window.clearTimeout(timer);};
  },[endpoint,runId,accountId,expectedOrganizationId]);
  if(!projection)return <WaiaSurface variant="raised" className="p-5"><p className="font-medium">Connecting to Historical V2…</p>{error?<p className="text-amber-300 mt-2 text-sm">{error}</p>:null}</WaiaSurface>;
  const first=projection.accounts[0];
  return <section className="space-y-4" data-testid="historical-v2-streaming-dashboard">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-semibold">Historical V2 · live observation</h2><p className="text-muted-foreground font-mono text-xs">{runId}</p></div><span className={`rounded-full border px-3 py-1 text-xs ${connected?"text-emerald-300":"text-amber-300"}`}>{connected?"LIVE · automatic":"Reconnecting…"}</span></div>
    {error?<p className="rounded border border-amber-500/30 p-3 text-sm text-amber-200">{error}</p>:null}
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"><Card title="Accounts" value={projection.aggregate.accountCount}/><Card title="Cash" value={scalar(projection.aggregate.cash)}/><Card title="Equity" value={scalar(projection.aggregate.equity)}/><Card title="Net P&L" value={scalar(projection.aggregate.netPnl)}/><Card title="Orders" value={projection.aggregate.orders}/><Card title="Fills / trades" value={projection.aggregate.fills}/></div>
    <WaiaSurface variant="raised" className="p-5"><div className="flex justify-between text-sm"><span>Progress · {projection.aggregate.processedRecords} committed records</span><span>cycle {projection.aggregate.latestCycleSequence??"—"}</span></div><div className="bg-muted mt-3 h-2 overflow-hidden rounded"><div className="h-2 w-full animate-pulse rounded bg-emerald-500/70"/></div><p className="text-muted-foreground mt-2 text-xs">Active stream; a completion percentage is not inferred without a qualified total-record authority.</p></WaiaSurface>
    <div className="grid gap-4 xl:grid-cols-2">{projection.accounts.map(account=>{const positions=Object.entries(record(record(account.lastAccounting).positions)).filter(([,value])=>{const quantity=scalar(record(value).quantity);return quantity!=="—"&&!/^[-+]?0+(?:\.0+)?$/.test(quantity);});return <WaiaSurface key={account.accountId} variant="raised" className="space-y-3 p-5"><div className="flex justify-between"><div><h3 className="font-semibold">{account.accountId}</h3><p className="text-muted-foreground text-xs">{account.symbol} · {account.partition}</p></div><span className="text-xs">cycle {account.cycleSequence}</span></div><div className="grid grid-cols-2 gap-3 text-sm"><div>Cash <b className="float-right">{scalar(account.cash)}</b></div><div>Equity <b className="float-right">{scalar(account.equity)}</b></div><div>Gross realized P&L <b className="float-right">{scalar(account.grossRealizedPnl)}</b></div><div>Net realized P&L <b className="float-right">{scalar(account.netRealizedPnl)}</b></div><div>Net unrealized P&L <b className="float-right">{scalar(account.netUnrealizedPnl)}</b></div><div>Net P&L <b className="float-right">{scalar(account.netPnl)}</b></div><div>Open positions <b className="float-right">{account.openPositionsCount}</b></div><div>Orders <b className="float-right">{account.ordersCount}</b></div><div>Fills / trades <b className="float-right">{account.fillsCount}</b></div></div><div className="border-border border-t pt-3 text-xs"><p className="font-semibold">Positions</p>{positions.length?positions.map(([symbol,value])=><p key={symbol}>{symbol}: qty {scalar(record(value).quantity)}</p>):<p className="text-muted-foreground">No open modeled positions.</p>}<p className="mt-2 font-semibold">Observed orders / fills</p>{account.observedExecutionEffects.length?account.observedExecutionEffects.map((effect,index)=><p key={index}>{reasons(effect)}</p>):<p className="text-muted-foreground">No effects committed on this cycle.</p>}<p className="mt-2"><b>Decision:</b> {reasons(account.lastDecision)}</p><p><b>Risk:</b> {reasons(account.lastRisk)}</p><p><b>Execution:</b> {reasons(account.lastExecution)}</p><p><b>Guardian:</b> {reasons(account.lastGuardian)}</p><p><b>Knowledge / learning:</b> {reasons(account.lastLearning)}</p><p><b>Stages:</b> {account.stages.join(", ")||"—"}</p><p><b>Snapshots:</b> {account.snapshots.join(", ")||"—"}</p><p><b>Checkpoint:</b> {account.checkpoint?`next record ${account.checkpoint.nextRecordIndex}`:"—"}</p></div></WaiaSurface>;})}</div>
    <p className="text-muted-foreground text-xs">Read-only historical simulation · automatic SSE/polling · no private credentials, live trading, Reality V2 or capital controls.</p>
  </section>;
}
