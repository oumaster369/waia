import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { loadHistoricalObservableProjectionPostgresV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-postgres-v2";
import { createHistoricalSimulationDurableStateSnapshotV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";

const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES);
const suite = enabled ? describe : describe.skip;

suite("historical observable read model v2 on PostgreSQL", () => {
  it("projects a durable tenant-bound ledger row and modeled fill", async () => {
    const sql = postgres(process.env.DATABASE_URL_POSTGRES!, { max: 1, prepare: false });
    let captured: Awaited<ReturnType<typeof loadHistoricalObservableProjectionPostgresV2>> | undefined;
    let operator: typeof captured; let wrongAccount: typeof captured; let wrongOrganization: typeof captured;
    let secondOrganization: typeof captured;
    const rollback = new Error("ROLLBACK_OBSERVABLE_FIXTURE");
    try {
      await sql.begin(async (tx) => {
        const suffix = crypto.randomUUID(); const userId=crypto.randomUUID(); const orgId=crypto.randomUUID();
        await tx`INSERT INTO auth.users (id) VALUES (${userId})`;
        await tx`INSERT INTO users (id,identity_label,email) VALUES (${userId},${`obs-${suffix}`},${`obs-${suffix}@test.invalid`})`;
        await tx`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES (${orgId},${userId},'personal','observable fixture')`;
        const org = { id: orgId }; const run = `observable-${suffix}`; const entry = `entry-${suffix}`;
        const digest = "a".repeat(64); const membershipDigest = "b".repeat(64);
        const membership = { schemaVersion: "waia.trader.historical_dataset_membership.v2",
          organizationId: org.id, cycleId: "cycle-0", partition: "DEVELOPMENT", contentDigestHex: membershipDigest };
        await tx.unsafe(`INSERT INTO trader_historical_simulation_reason_ledger_v2
          (entry_id,organization_id,account_id,run_id,cycle_id,cycle_sequence,symbol,partition,capital_eligible,
           replay_bar_closed_at_utc,previous_content_digest_hex,forecast_json,decision_json,portfolio_json,risk_json,
           execution_json,accounting_json,guardian_json,learning_json,content_digest_hex,
           observed_execution_effects_json,dataset_membership_content_digest_hex,dataset_membership_json)
          VALUES ($1,$2::uuid,$3,$4,$5,0,'BTCUSDT','DEVELOPMENT',false,now(),null,
           '{}'::jsonb,'{"action":"CASH"}'::jsonb,'{"positions":[]}'::jsonb,'{"status":"PERMITTED"}'::jsonb,
           '{"status":"NO_TRADE"}'::jsonb,'{"cash":"100.00000000","equity":"100.00000000","netRealizedPnl":"0.00000000"}'::jsonb,
           '{}'::jsonb,'{}'::jsonb,$6,'[]'::jsonb,$7,$8::jsonb)`,
          [entry, org.id, "tenant-account", run, "cycle-0", digest, membershipDigest, JSON.stringify(membership)]);
        await tx.unsafe(`INSERT INTO trader_historical_simulation_modeled_evidence_v2
          (evidence_id,organization_id,reason_ledger_entry_id,evidence_kind,evidence_ordinal,
           evidence_content_digest_hex,payload_json,capital_eligible)
          VALUES ($1,$2::uuid,$3,'FILL',0,$4,'{}'::jsonb,false)`,
          [`fill-${suffix}`, org.id, entry, "c".repeat(64)]);
        const accountingBody={schemaVersion:"htr-accounting-frontier/v1" as const,engineId:"CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1" as const,
          basisMethod:"DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1" as const,organizationId:org.id,accountKey:"tenant-account",runId:run,
          accountingSequence:0,frontierAsOf:"2026-01-01T00:00:00.000Z",monthKey:"2026-01",cash:"100.00000000",positions:{},
          grossRealizedPnl:"0.00000000",netRealizedPnl:"0.00000000",marks:{},markedPositionValue:"0.00000000",equity:"100.00000000",
          equityHwm:"100.00000000",accountDrawdownBps:0,consumedFillIds:[],id:`${run}:frontier:0`,sourceFillId:null,
          sourceEconomicsDigest:"d".repeat(64),idempotencyKey:`${run}:frontier:0`};
        const state={...accountingBody,semanticContentDigest:computeAccountingSemanticDigest(accountingBody)};
        const accountingSnapshot=createHistoricalSimulationDurableStateSnapshotV2({organizationId:org.id,accountId:"tenant-account",runId:run,split:"DEVELOPMENT",
          cycleId:"cycle-0",stateKind:"ACCOUNTING_FRONTIER",state});
        const snapshotDigest=accountingSnapshot.contentDigestHex; const checkpointDigest="e".repeat(64); const requestDigest="f".repeat(64);
        await tx.unsafe(`INSERT INTO trader_historical_simulation_durable_snapshot_v2
          (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,
           ledger_entry_content_digest_hex,state_json,snapshot_content_digest_hex,schema_version)
          VALUES ($1::uuid,'tenant-account',$2,0,'cycle-0','ACCOUNTING_FRONTIER',$3,$4,$5::jsonb,$6,
           'waia.trader.historical_simulation_durable_state_snapshot.v2')`, [org.id,run,entry,digest,
          JSON.stringify(accountingSnapshot.state),snapshotDigest]);
        const request={schemaVersion:"waia.trader.historical_simulation_commit_request.v2",contentDigestHex:requestDigest,
          organizationId:org.id,accountId:"tenant-account",runId:run,cycleSequence:0,cycleId:"cycle-0"};
        await tx.unsafe(`INSERT INTO trader_historical_simulation_resume_checkpoint_v2
          (organization_id,account_id,run_id,split,committed_cycle_sequence,committed_cycle_id,ledger_entry_id,
           ledger_head_content_digest_hex,next_record_index,next_cycle_sequence,dataset_authority_json,stage_digest_json,
           snapshot_digest_json,checkpoint_json,checkpoint_content_digest_hex,commit_request_digest_hex,commit_request_json,schema_version)
          VALUES ($1::uuid,'tenant-account',$2,'DEVELOPMENT',0,'cycle-0',$3,$4,1,1,'{}'::jsonb,'{}'::jsonb,
           $5::jsonb,'{}'::jsonb,$6,$7,$8::jsonb,'waia.trader.historical_simulation_resume_cursor.v2')`,
          [org.id,run,entry,digest,JSON.stringify({ACCOUNTING_FRONTIER:snapshotDigest}),checkpointDigest,requestDigest,JSON.stringify(request)]);
        await tx.unsafe(`INSERT INTO trader_historical_simulation_resume_snapshot_link_v2
          (organization_id,account_id,run_id,committed_cycle_sequence,state_kind,snapshot_content_digest_hex)
          VALUES ($1::uuid,'tenant-account',$2,0,'ACCOUNTING_FRONTIER',$3)`,[org.id,run,snapshotDigest]);
        const addCommittedAccount=async(targetOrg:string,accountId:string,cycleId:string,equity:string)=>{
          const targetEntry=`entry-${accountId}-${suffix}`;const targetLedgerDigest=(accountId==="account-two"?"3":"4").repeat(64);
          const targetMembershipDigest=(accountId==="account-two"?"5":"6").repeat(64);
          const targetMembership={...membership,organizationId:targetOrg,cycleId,contentDigestHex:targetMembershipDigest};
          await tx.unsafe(`INSERT INTO trader_historical_simulation_reason_ledger_v2
            (entry_id,organization_id,account_id,run_id,cycle_id,cycle_sequence,symbol,partition,capital_eligible,replay_bar_closed_at_utc,
             forecast_json,decision_json,portfolio_json,risk_json,execution_json,accounting_json,guardian_json,learning_json,content_digest_hex,
             observed_execution_effects_json,dataset_membership_content_digest_hex,dataset_membership_json)
            VALUES ($1,$2::uuid,$3,$4,$5,0,'BTCUSDT','DEVELOPMENT',false,now(),'{}','{"action":"CASH"}','{}','{}','{}','{}','{}','{}',$6,'[]',$7,$8::jsonb)`,
            [targetEntry,targetOrg,accountId,run,cycleId,targetLedgerDigest,targetMembershipDigest,JSON.stringify(targetMembership)]);
          const b={...accountingBody,organizationId:targetOrg,accountKey:accountId,cash:equity,equity,equityHwm:equity,
            id:`${run}:${accountId}:frontier:0`,idempotencyKey:`${run}:${accountId}:frontier:0`};
          const targetState={...b,semanticContentDigest:computeAccountingSemanticDigest(b)};
          const targetSnapshot=createHistoricalSimulationDurableStateSnapshotV2({organizationId:targetOrg,accountId,runId:run,split:"DEVELOPMENT",cycleId,
            stateKind:"ACCOUNTING_FRONTIER",state:targetState});
          await tx.unsafe(`INSERT INTO trader_historical_simulation_durable_snapshot_v2
            (organization_id,account_id,run_id,cycle_sequence,cycle_id,state_kind,ledger_entry_id,ledger_entry_content_digest_hex,state_json,
             snapshot_content_digest_hex,schema_version) VALUES ($1::uuid,$2,$3,0,$4,'ACCOUNTING_FRONTIER',$5,$6,$7::jsonb,$8,
             'waia.trader.historical_simulation_durable_state_snapshot.v2')`,[targetOrg,accountId,run,cycleId,targetEntry,targetLedgerDigest,
             JSON.stringify(targetState),targetSnapshot.contentDigestHex]);
          const targetReq={...request,organizationId:targetOrg,accountId,cycleId,contentDigestHex:(accountId==="account-two"?"7":"8").repeat(64)};
          await tx.unsafe(`INSERT INTO trader_historical_simulation_resume_checkpoint_v2
            (organization_id,account_id,run_id,split,committed_cycle_sequence,committed_cycle_id,ledger_entry_id,ledger_head_content_digest_hex,
             next_record_index,next_cycle_sequence,dataset_authority_json,stage_digest_json,snapshot_digest_json,checkpoint_json,
             checkpoint_content_digest_hex,commit_request_digest_hex,commit_request_json,schema_version)
            VALUES ($1::uuid,$2,$3,'DEVELOPMENT',0,$4,$5,$6,1,1,'{}','{}',$7::jsonb,'{}',$8,$9,$10::jsonb,
             'waia.trader.historical_simulation_resume_cursor.v2')`,[targetOrg,accountId,run,cycleId,targetEntry,targetLedgerDigest,
             JSON.stringify({ACCOUNTING_FRONTIER:targetSnapshot.contentDigestHex}),"9".repeat(64),targetReq.contentDigestHex,JSON.stringify(targetReq)]);
          await tx.unsafe(`INSERT INTO trader_historical_simulation_resume_snapshot_link_v2
            (organization_id,account_id,run_id,committed_cycle_sequence,state_kind,snapshot_content_digest_hex)
            VALUES ($1::uuid,$2,$3,0,'ACCOUNTING_FRONTIER',$4)`,[targetOrg,accountId,run,targetSnapshot.contentDigestHex]);
        };
        await addCommittedAccount(org.id,"account-two","cycle-two","50.00000000");
        const user2=crypto.randomUUID(),org2=crypto.randomUUID();
        await tx`INSERT INTO auth.users (id) VALUES (${user2})`;
        await tx`INSERT INTO users (id,identity_label,email) VALUES (${user2},${`obs2-${suffix}`},${`obs2-${suffix}@test.invalid`})`;
        await tx`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES (${org2},${user2},'personal','observable fixture 2')`;
        await addCommittedAccount(org2,"foreign-account","cycle-foreign","900.00000000");
        const [snapshotCheck]=await tx.unsafe<{state_json:unknown}[]>(`SELECT s.state_json FROM trader_historical_simulation_resume_snapshot_link_v2 l
          JOIN trader_historical_simulation_durable_snapshot_v2 s ON s.organization_id=l.organization_id AND s.account_id=l.account_id
          AND s.run_id=l.run_id AND s.cycle_sequence=l.committed_cycle_sequence AND s.state_kind=l.state_kind
          AND s.snapshot_content_digest_hex=l.snapshot_content_digest_hex WHERE l.organization_id=$1::uuid AND l.run_id=$2`,[org.id,run]);
        if (!snapshotCheck) throw new Error("ACCOUNTING_SNAPSHOT_FIXTURE_MISSING");
        const uncommittedMembership={...membership,cycleId:"cycle-1",contentDigestHex:"1".repeat(64)};
        await tx.unsafe(`INSERT INTO trader_historical_simulation_reason_ledger_v2
          (entry_id,organization_id,account_id,run_id,cycle_id,cycle_sequence,symbol,partition,capital_eligible,
           replay_bar_closed_at_utc,previous_content_digest_hex,forecast_json,decision_json,portfolio_json,risk_json,
           execution_json,accounting_json,guardian_json,learning_json,content_digest_hex,
           observed_execution_effects_json,dataset_membership_content_digest_hex,dataset_membership_json)
          VALUES ($1,$2::uuid,'tenant-account',$3,'cycle-1',1,'BTCUSDT','DEVELOPMENT',false,now(),$4,
           '{}'::jsonb,'{"action":"ENTER_LONG"}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
           '{}'::jsonb,'{}'::jsonb,$5,'[]'::jsonb,$6,$7::jsonb)`,[`uncommitted-${suffix}`,org.id,run,digest,
          "2".repeat(64),uncommittedMembership.contentDigestHex,JSON.stringify(uncommittedMembership)]);
        captured = await loadHistoricalObservableProjectionPostgresV2(tx, {
          organizationId: org.id, runId: run, accountId: "tenant-account",
        });
        operator=await loadHistoricalObservableProjectionPostgresV2(tx,{organizationId:org.id,runId:run});
        wrongAccount=await loadHistoricalObservableProjectionPostgresV2(tx,{organizationId:org.id,runId:run,accountId:"other-account"});
        wrongOrganization=await loadHistoricalObservableProjectionPostgresV2(tx,{organizationId:crypto.randomUUID(),runId:run});
        secondOrganization=await loadHistoricalObservableProjectionPostgresV2(tx,{organizationId:org2,runId:run});
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await sql.end({ timeout: 5 }); }
    expect(captured).toMatchObject({ capitalEligible: false,
      aggregate: { accountCount: 1, equity: "100.00000000", fills: 1, processedRecords: 1 },
      accounts: [{ accountId: "tenant-account", cycleSequence:0, decisionsCount:1, lastDecision: { action: "CASH" },
        lastAccounting: { equity: "100.00000000" } }] });
    expect(operator?.aggregate).toMatchObject({accountCount:2,equity:"150.00000000"});
    expect(operator?.accounts.map((item)=>item.accountId).sort()).toEqual(["account-two","tenant-account"]);
    expect(wrongAccount?.accounts).toEqual([]);expect(wrongOrganization?.accounts).toEqual([]);
    expect(secondOrganization?.aggregate).toMatchObject({accountCount:1,equity:"900.00000000"});
  });
});
