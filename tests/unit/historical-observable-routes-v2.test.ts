import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  userId:"user-a" as string|null,access:true,authorized:true,
  serve:vi.fn(),disposeAuth:vi.fn(),disposeSql:vi.fn(),authorize:vi.fn(),
}));
vi.mock("@/lib/auth/session-user",()=>({getOptionalSessionUserId:vi.fn(async()=>mocks.userId)}));
vi.mock("@/lib/trader/access-gate",()=>({hasTraderAccessForUser:vi.fn(async()=>mocks.access)}));
vi.mock("@/lib/waia-core/ids",()=>({personalOrganizationIdFromUserId:(id:string)=>`personal:${id}`}));
vi.mock("@/db/postgres-client",()=>({createPerRequestPostgresRuntime:()=>({_sql:{unsafe:vi.fn()}}),
  disposePostgresClientSafely:mocks.disposeSql}));
vi.mock("@/lib/trader/admin-route-deps",()=>({createProductionAdminRouteDeps:()=>({disposeRuntimeDb:mocks.disposeAuth})}));
vi.mock("@/lib/trader/admin-route-shared",()=>({parseOrganizationId:(url:URL)=>url.searchParams.get("organization_id") ?? "missing",
  authorizeAdminRoute:mocks.authorize}));
vi.mock("@/lib/trader/historical-simulation-v2/observable-http-v2",()=>({serveHistoricalObservableV2:mocks.serve}));

import { GET as tenantGet } from "@/app/api/trader/historical-v2/stream/route";
import { GET as adminGet } from "@/app/api/trader/admin/historical-v2/stream/route";

describe("historical observable route isolation v2",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();mocks.userId="user-a";mocks.access=true;mocks.authorized=true;
    mocks.serve.mockResolvedValue(new Response("ok"));
    mocks.authorize.mockImplementation(async(_deps:unknown,organizationId:string,permission:string)=>
      mocks.authorized?{ok:true,runtime:{organizationId,permission}}:{ok:false,result:{status:403,body:{error:{code:"FORBIDDEN"}}}});
  });
  it("derives tenant organization from session and requires an exact account",async()=>{
    await tenantGet(new Request("https://waia.test/api?run_id=run&account_id=owned"));
    expect(mocks.serve).toHaveBeenCalledWith(expect.objectContaining({scope:{organizationId:"personal:user-a",runId:"run",accountId:"owned"}}));
    const missing=await tenantGet(new Request("https://waia.test/api?run_id=run"));
    expect(missing.status).toBe(400);
  });
  it("refuses unauthenticated and unentitled tenant requests before database creation",async()=>{
    mocks.userId=null;expect((await tenantGet(new Request("https://waia.test/api?run_id=r&account_id=a"))).status).toBe(401);
    mocks.userId="user-a";mocks.access=false;
    expect((await tenantGet(new Request("https://waia.test/api?run_id=r&account_id=a"))).status).toBe(403);
    expect(mocks.serve).not.toHaveBeenCalled();
  });
  it("binds operator query to the parsed organization only after audit permission",async()=>{
    await adminGet(new Request("https://waia.test/api?organization_id=org-b&run_id=run"));
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),"org-b","admin.audit.read");
    expect(mocks.serve).toHaveBeenCalledWith(expect.objectContaining({scope:{organizationId:"org-b",runId:"run"}}));
    expect(mocks.disposeAuth).toHaveBeenCalledOnce();
  });
  it("does not open operator projection when audit permission is denied",async()=>{
    mocks.authorized=false;
    const response=await adminGet(new Request("https://waia.test/api?organization_id=org-b&run_id=run"));
    expect(response.status).toBe(403);expect(mocks.serve).not.toHaveBeenCalled();expect(mocks.disposeAuth).toHaveBeenCalledOnce();
  });
});
