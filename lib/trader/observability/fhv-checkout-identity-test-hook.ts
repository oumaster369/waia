/** @internal vitest-only — not referenced from package scripts or public CLI. */

let skipCheckoutIdentityVerification = false;

export function enableFhvCheckoutIdentityTestBypass(): void {
  skipCheckoutIdentityVerification = true;
}

export function disableFhvCheckoutIdentityTestBypass(): void {
  skipCheckoutIdentityVerification = false;
}

export function shouldSkipFhvCheckoutIdentityVerification(): boolean {
  return skipCheckoutIdentityVerification;
}
