import { accountObservationRoute } from "@/lib/trader/account-observation/route";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return accountObservationRoute(request, "tenant"); }
