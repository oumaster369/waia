/** Credential payload AAD prefix for DEE-196, distinct from the DEK wrap AAD.
 *
 * Kept in its own module rather than in `lib/trader/security/index.ts` so credential envelope
 * crypto can bind the AAD without importing the security barrel, whose re-exports otherwise pull
 * the HTX exchange connector into every credential consumer's module graph (DEE-1015). The barrel
 * still re-exports this function, so existing importers are unaffected.
 */
export function credentialPayloadAad(keyVersion: string): string {
  return `waia:trader:cred:${keyVersion}`;
}
