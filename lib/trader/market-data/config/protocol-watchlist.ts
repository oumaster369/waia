export type ProtocolWatchlistEntry = {
  owner: string;
  repo: string;
};

export const PROTOCOL_WATCHLIST = [
  { owner: "bitcoin", repo: "bitcoin" },
  { owner: "ethereum", repo: "go-ethereum" },
] as const satisfies readonly ProtocolWatchlistEntry[];
