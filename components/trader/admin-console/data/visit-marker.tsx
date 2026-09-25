"use client";
import { useEffect, useRef } from "react";
/** Owner-only presence marker; failure must never prevent console reads. */
export function AdminVisitMarker({ userId }: { userId: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const key = `waia:admin-visit:${userId}`;
    const readStamp = () => {
      try {
        return Number(sessionStorage.getItem(key) ?? 0);
      } catch {
        return 0;
      }
    };
    if (Date.now() - readStamp() < 30 * 60_000) return;
    void (async () => {
      try {
        const result = await fetch("/api/trader/admin/console/visit-marker", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!result.ok) return;
        const marker = await result.json();
        if (typeof marker.revision !== "string") return;
        const saved = await fetch("/api/trader/admin/console/visit-marker", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevision: marker.revision }),
        });
        if (saved.ok || saved.status === 409) {
          try {
            sessionStorage.setItem(key, String(Date.now()));
          } catch {}
        }
      } catch {
        /* Presence is optional; no old facts or permissions are inferred. */
      }
    })();
  }, [userId]);
  return null;
}
