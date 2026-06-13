export type { ModuleHost, ModuleKey } from "@/lib/hosts/types";
export { resolveWaiaCookieDomain } from "@/lib/hosts/cookie-domain";
export {
  buildModuleUrl,
  extractHostnameFromHeaders,
  isModuleHost,
  isTraderHostRoutingEnabled,
  normalizeHostname,
  resolveModuleHost,
} from "@/lib/hosts/resolve";
