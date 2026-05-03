import { oauthProviderEnum, type OauthProvider } from "@/db/schema";

export function parseOauthProviderSegment(raw: string | undefined): OauthProvider | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  return (oauthProviderEnum as readonly string[]).includes(raw) ? (raw as OauthProvider) : null;
}
