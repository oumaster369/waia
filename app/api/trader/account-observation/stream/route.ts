import { accountObservationRoute } from "@/lib/trader/account-observation/route";
import { handleAccountObservationStream } from "@/lib/trader/account-observation/stream-handler";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAccountObservationStream(request, (next) => accountObservationRoute(next, "tenant"));
}
