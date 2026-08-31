/**
 * Deliberately static observer shell.
 *
 * Cloudflare's request CPU budget must not be spent resolving a session or
 * provisioning trader runtime while rendering HTML. The browser never receives
 * protected data from this layout: every tenant-scoped read/stream and every
 * command remains fail-closed in its authenticated API handler.
 */
export default function TraderModuleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
import { Suspense } from "react";
