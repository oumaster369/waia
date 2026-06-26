/**
 * OpenNext build output placeholder for typecheck on clean checkout.
 * `pnpm cloudflare:build` overwrites this file locally (remains gitignored delta).
 */
export default {
  fetch() {
    return new Response("open-next worker stub", { status: 501 });
  },
};

export class DOQueueHandler {}
export class DOShardedTagCache {}
