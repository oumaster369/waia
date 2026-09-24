export const ADMIN_ACCESS_REVOKED_EVENT = "waia:admin-access-revoked";
export function notifyAdminAccessRevoked(): void {
  window.dispatchEvent(new Event(ADMIN_ACCESS_REVOKED_EVENT));
}
