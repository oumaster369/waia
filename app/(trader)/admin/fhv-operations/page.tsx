"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AdminErrorState,AdminLoadingState,AdminOrgSelector,useAdminOrganizations } from "@/components/trader/admin/admin-org-selector";
import { HistoricalRatificationCeremonyV2 } from "@/components/trader/admin/historical-ratification-ceremony-v2";
import { HistoricalV2ObservationDashboard } from "@/components/trader/historical-v2-observation-dashboard";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { FHV_CAMPAIGN_RUN_ID_MAX_LENGTH,FHV_CAMPAIGN_RUN_ID_PATTERN } from "@/lib/trader/fhv-campaign-run-id";

function validateRunId(value:string){const v=value.trim();if(!v)return "Campaign run ID is required.";if(v.length>FHV_CAMPAIGN_RUN_ID_MAX_LENGTH)return "Campaign run ID is too long.";return FHV_CAMPAIGN_RUN_ID_PATTERN.test(v)?null:"Campaign run ID format is invalid.";}
export default function FhvOperationsAdminPage(){
  const params=useSearchParams();const {organizations,loading,error}=useAdminOrganizations();
  const [selected,setSelected]=React.useState("");const organizationId=selected||organizations[0]?.id||"";
  const [runId,setRunId]=React.useState(()=>params.get("campaign_run_id")?.trim()??"");const runError=validateRunId(runId);
  const releaseSha=params.get("release_sha")?.trim().toLowerCase()??"";
  const endpoint=`/api/trader/admin/historical-v2/stream?organization_id=${encodeURIComponent(organizationId)}&run_id=${encodeURIComponent(runId.trim())}`;
  return <div className="space-y-5"><WaiaSurface variant="raised" className="space-y-4 p-5"><div><h1 className="text-lg font-semibold">Observation target</h1><p className="text-muted-foreground mt-1 text-sm">Historical V2 connects automatically through SSE and falls back to safe polling. No refresh or Sync action is required.</p></div>{loading?<AdminLoadingState label="Loading organizations…"/>:null}{error?<AdminErrorState message={error}/>:null}{!loading&&!error?<AdminOrgSelector organizations={organizations} value={organizationId} onChange={setSelected}/>:null}<label className="block space-y-1 text-sm"><span className="font-medium">Campaign run ID</span><input data-testid="fhv-campaign-run-id" className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono text-sm" value={runId} onChange={event=>setRunId(event.target.value)} maxLength={FHV_CAMPAIGN_RUN_ID_MAX_LENGTH}/></label>{runError?<AdminErrorState message={runError}/>:null}</WaiaSurface>{organizationId&&!runError?<HistoricalRatificationCeremonyV2 organizationId={organizationId} runId={runId.trim()} initialReleaseSha={releaseSha}/>:null}{organizationId&&!runError?<HistoricalV2ObservationDashboard key={`${organizationId}:${runId}`} endpoint={endpoint} runId={runId.trim()} expectedOrganizationId={organizationId}/>:null}</div>;
}
