import type { MarketDataProviderId } from "@/lib/trader/market-data/observation-types";
import type {
  ReplayProviderSidecarEntryV1,
  ReplayProviderSidecarLaneKey,
  ReplayProviderSidecarLanesV2,
  ReplayProviderSidecarTimelineEntryV3,
  SidecarLaneCrossExchange,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { REPLAY_PROVIDER_SIDECAR_LANE_KEYS } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export type PitTimelineEntry = {
  eventTimeUtc: string;
  ingestTimeUtc: string;
  availableAtUtc?: string;
  providerId: MarketDataProviderId;
  feedKind: string;
  sourceDigest: string;
  payload: unknown;
};

export type PitEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason: "event_after_evaluated" | "ingest_after_evaluated" | "available_after_evaluated";
    };

export const PIT_TIE_BREAK_ORDER = [
  "availableAtUtc_or_ingestTimeUtc_desc",
  "eventTimeUtc_desc",
  "providerId_feedKind_asc",
  "sourceDigest_asc",
] as const;

function parseUtcMs(iso: string): number {
  return Date.parse(iso);
}

function timelineEntry(input: {
  eventTimeUtc: string;
  ingestTimeUtc: string;
  availableAtUtc?: string;
  providerId: MarketDataProviderId;
  feedKind: string;
  payload: unknown;
}): PitTimelineEntry {
  return {
    eventTimeUtc: input.eventTimeUtc,
    ingestTimeUtc: input.ingestTimeUtc,
    availableAtUtc: input.availableAtUtc,
    providerId: input.providerId,
    feedKind: input.feedKind,
    sourceDigest: computeStableJsonDigest(input.payload),
    payload: input.payload,
  };
}

export function isPitEligible(
  entry: Pick<PitTimelineEntry, "eventTimeUtc" | "ingestTimeUtc" | "availableAtUtc">,
  evaluatedAtUtc: string,
): PitEligibility {
  const evaluatedMs = parseUtcMs(evaluatedAtUtc);
  if (!Number.isFinite(evaluatedMs)) {
    return { eligible: false, reason: "event_after_evaluated" };
  }

  const eventMs = parseUtcMs(entry.eventTimeUtc);
  if (!Number.isFinite(eventMs) || eventMs > evaluatedMs) {
    return { eligible: false, reason: "event_after_evaluated" };
  }

  const ingestMs = parseUtcMs(entry.ingestTimeUtc);
  if (!Number.isFinite(ingestMs) || ingestMs > evaluatedMs) {
    return { eligible: false, reason: "ingest_after_evaluated" };
  }

  if (entry.availableAtUtc !== undefined && entry.availableAtUtc !== "") {
    const availableMs = parseUtcMs(entry.availableAtUtc);
    if (!Number.isFinite(availableMs) || availableMs > evaluatedMs) {
      return { eligible: false, reason: "available_after_evaluated" };
    }
  }

  return { eligible: true };
}

export function dedupePitTimelineEntries(entries: readonly PitTimelineEntry[]): PitTimelineEntry[] {
  const seen = new Map<string, PitTimelineEntry>();
  for (const entry of entries) {
    const key = `${entry.eventTimeUtc}\0${entry.providerId}\0${entry.sourceDigest}`;
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

function availabilitySortKey(entry: PitTimelineEntry): number {
  const ms = entry.availableAtUtc
    ? parseUtcMs(entry.availableAtUtc)
    : parseUtcMs(entry.ingestTimeUtc);
  return Number.isFinite(ms) ? ms : 0;
}

export function selectEligibleEntry(
  entries: readonly PitTimelineEntry[],
  evaluatedAtUtc: string,
): PitTimelineEntry | undefined {
  const eligible = dedupePitTimelineEntries(entries).filter(
    (entry) => isPitEligible(entry, evaluatedAtUtc).eligible,
  );
  if (eligible.length === 0) {
    return undefined;
  }

  eligible.sort((a, b) => {
    const availabilityDiff = availabilitySortKey(b) - availabilitySortKey(a);
    if (availabilityDiff !== 0) {
      return availabilityDiff;
    }

    const eventDiff = parseUtcMs(b.eventTimeUtc) - parseUtcMs(a.eventTimeUtc);
    if (eventDiff !== 0) {
      return eventDiff;
    }

    const providerDiff = a.providerId.localeCompare(b.providerId);
    if (providerDiff !== 0) {
      return providerDiff;
    }

    const feedDiff = a.feedKind.localeCompare(b.feedKind);
    if (feedDiff !== 0) {
      return feedDiff;
    }

    return a.sourceDigest.localeCompare(b.sourceDigest);
  });

  return eligible[0];
}

export function resolvePitLane(
  entries: readonly PitTimelineEntry[],
  evaluatedAtUtc: string,
): PitTimelineEntry | undefined {
  return selectEligibleEntry(entries, evaluatedAtUtc);
}

function resolvePerProviderEntries(
  entries: readonly PitTimelineEntry[],
  evaluatedAtUtc: string,
): PitTimelineEntry[] {
  const eligible = dedupePitTimelineEntries(entries).filter(
    (entry) => isPitEligible(entry, evaluatedAtUtc).eligible,
  );
  const byProvider = new Map<string, PitTimelineEntry>();
  for (const entry of eligible) {
    const existing = byProvider.get(entry.providerId);
    if (!existing) {
      byProvider.set(entry.providerId, entry);
      continue;
    }
    const winner = selectEligibleEntry([existing, entry], evaluatedAtUtc);
    if (winner) {
      byProvider.set(entry.providerId, winner);
    }
  }
  return [...byProvider.values()].sort((a, b) => {
    const providerDiff = a.providerId.localeCompare(b.providerId);
    if (providerDiff !== 0) {
      return providerDiff;
    }
    return a.sourceDigest.localeCompare(b.sourceDigest);
  });
}

function resolvePerPayloadKeyEntries(
  entries: readonly PitTimelineEntry[],
  evaluatedAtUtc: string,
  keyFn: (payload: unknown) => string,
): PitTimelineEntry[] {
  const eligible = dedupePitTimelineEntries(entries).filter(
    (entry) => isPitEligible(entry, evaluatedAtUtc).eligible,
  );
  const byKey = new Map<string, PitTimelineEntry>();
  for (const entry of eligible) {
    const key = keyFn(entry.payload);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      continue;
    }
    const winner = selectEligibleEntry([existing, entry], evaluatedAtUtc);
    if (winner) {
      byKey.set(key, winner);
    }
  }
  return [...byKey.values()].sort((a, b) => a.sourceDigest.localeCompare(b.sourceDigest));
}

export function resolveSidecarTimelinesAtPit(input: {
  timelines: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>>;
  evaluatedAtUtc: string;
}): Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry | PitTimelineEntry[]>> {
  const resolved: Partial<
    Record<ReplayProviderSidecarLaneKey, PitTimelineEntry | PitTimelineEntry[]>
  > = {};

  const setSingle = (laneKey: ReplayProviderSidecarLaneKey, entries: PitTimelineEntry[]) => {
    const selected = resolvePitLane(entries, input.evaluatedAtUtc);
    if (selected) {
      resolved[laneKey] = selected;
    }
  };

  for (const laneKey of REPLAY_PROVIDER_SIDECAR_LANE_KEYS) {
    const entries = input.timelines[laneKey];
    if (!entries || entries.length === 0) {
      continue;
    }

    switch (laneKey) {
      case "cross_exchange_confirmation":
        resolved[laneKey] = resolvePerProviderEntries(entries, input.evaluatedAtUtc);
        break;
      case "macro_series":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { seriesId?: string }).seriesId ?? ""),
        );
        break;
      case "macro_calendar_event":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { eventId?: string }).eventId ?? ""),
        );
        break;
      case "macro_probability":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { meetingDate?: string }).meetingDate ?? ""),
        );
        break;
      case "news_headline":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { url?: string }).url ?? ""),
        );
        break;
      case "exchange_announcement":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { announcementId?: string }).announcementId ?? ""),
        );
        break;
      case "protocol_release":
        resolved[laneKey] = resolvePerPayloadKeyEntries(
          entries,
          input.evaluatedAtUtc,
          (payload) => {
            const p = payload as { owner?: string; repo?: string; tagName?: string };
            return `${p.owner ?? ""}/${p.repo ?? ""}@${p.tagName ?? ""}`;
          },
        );
        break;
      case "blockchain_network_stats":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { network?: string }).network ?? ""),
        );
        break;
      case "regulatory_filing":
        resolved[laneKey] = resolvePerPayloadKeyEntries(entries, input.evaluatedAtUtc, (payload) =>
          String((payload as { accessionNumber?: string }).accessionNumber ?? ""),
        );
        break;
      default:
        setSingle(laneKey, entries);
        break;
    }
  }

  return resolved;
}

export function sidecarV1EntryToTimeline(
  entry: ReplayProviderSidecarEntryV1,
  evaluatedAt: string,
): Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> {
  const timelines: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> = {};
  const ingestTimeUtc = evaluatedAt;

  if (entry.fearGreed) {
    const payload = {
      value: entry.fearGreed.value,
      classification: entry.fearGreed.classification,
      eventTimeUtc: evaluatedAt,
    };
    timelines.fear_greed_index = [
      timelineEntry({
        eventTimeUtc: evaluatedAt,
        ingestTimeUtc,
        providerId: "alternative_me",
        feedKind: "fear_greed_index",
        payload,
      }),
    ];
  }

  if (entry.globalMarket) {
    const payload = {
      btcDominance: entry.globalMarket.btcDominance,
      marketCapUsd: entry.globalMarket.marketCapUsd,
      eventTimeUtc: evaluatedAt,
    };
    timelines.global_market_stats = [
      timelineEntry({
        eventTimeUtc: evaluatedAt,
        ingestTimeUtc,
        providerId: "coingecko_global",
        feedKind: "global_market_stats",
        payload,
      }),
    ];
  }

  const crossEntries: PitTimelineEntry[] = [];
  if (entry.binanceConfirmLast) {
    const payload: SidecarLaneCrossExchange = {
      confirmVenue: "binance",
      confirmLast: entry.binanceConfirmLast,
      eventTimeUtc: evaluatedAt,
    };
    crossEntries.push(
      timelineEntry({
        eventTimeUtc: evaluatedAt,
        ingestTimeUtc,
        providerId: "binance_public",
        feedKind: "cross_exchange_confirmation",
        payload,
      }),
    );
  }
  if (entry.bybitConfirmLast) {
    const payload: SidecarLaneCrossExchange = {
      confirmVenue: "bybit",
      confirmLast: entry.bybitConfirmLast,
      eventTimeUtc: evaluatedAt,
    };
    crossEntries.push(
      timelineEntry({
        eventTimeUtc: evaluatedAt,
        ingestTimeUtc,
        providerId: "bybit_public",
        feedKind: "cross_exchange_confirmation",
        payload,
      }),
    );
  }
  if (crossEntries.length > 0) {
    timelines.cross_exchange_confirmation = crossEntries;
  }

  return timelines;
}

export function sidecarV2LanesToTimelines(
  lanes: ReplayProviderSidecarLanesV2,
  captureAsOfUtc: string,
): Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> {
  const timelines: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> = {};
  const ingestTimeUtc = captureAsOfUtc;

  const pushSingle = (
    laneKey: ReplayProviderSidecarLaneKey,
    eventTimeUtc: string,
    providerId: MarketDataProviderId,
    feedKind: string,
    payload: unknown,
  ) => {
    const entries = timelines[laneKey] ?? [];
    entries.push(timelineEntry({ eventTimeUtc, ingestTimeUtc, providerId, feedKind, payload }));
    timelines[laneKey] = entries;
  };

  if (lanes.fear_greed_index) {
    const lane = lanes.fear_greed_index;
    pushSingle("fear_greed_index", lane.eventTimeUtc, "alternative_me", "fear_greed_index", lane);
  }

  if (lanes.global_market_stats) {
    const lane = lanes.global_market_stats;
    pushSingle(
      "global_market_stats",
      lane.eventTimeUtc,
      "coingecko_global",
      "global_market_stats",
      lane,
    );
  }

  for (const lane of lanes.cross_exchange_confirmation ?? []) {
    pushSingle(
      "cross_exchange_confirmation",
      lane.eventTimeUtc,
      lane.confirmVenue === "binance" ? "binance_public" : "bybit_public",
      "cross_exchange_confirmation",
      lane,
    );
  }

  if (lanes.order_book_snapshot) {
    const lane = lanes.order_book_snapshot;
    pushSingle("order_book_snapshot", lane.eventTimeUtc, "htx_spot", "order_book_snapshot", lane);
  }

  if (lanes.market_trades_snapshot) {
    const lane = lanes.market_trades_snapshot;
    pushSingle(
      "market_trades_snapshot",
      lane.eventTimeUtc,
      "htx_spot",
      "market_trades_snapshot",
      lane,
    );
  }

  for (const lane of lanes.macro_series ?? []) {
    pushSingle("macro_series", lane.eventTimeUtc, "fred", "macro_series", lane);
  }

  for (const lane of lanes.macro_calendar_event ?? []) {
    pushSingle(
      "macro_calendar_event",
      lane.eventTimeUtc,
      "federal_reserve",
      "macro_calendar_event",
      lane,
    );
  }

  for (const lane of lanes.macro_probability ?? []) {
    pushSingle("macro_probability", lane.eventTimeUtc, "cme_fedwatch", "macro_probability", lane);
  }

  for (const lane of lanes.news_headline ?? []) {
    pushSingle("news_headline", lane.eventTimeUtc, lane.providerId, "news_headline", lane);
  }

  if (lanes.news_event_cluster) {
    const lane = lanes.news_event_cluster;
    pushSingle("news_event_cluster", lane.eventTimeUtc, "gdelt", "news_event_cluster", lane);
  }

  for (const lane of lanes.exchange_announcement ?? []) {
    pushSingle(
      "exchange_announcement",
      lane.eventTimeUtc,
      lane.providerId,
      "exchange_announcement",
      lane,
    );
  }

  for (const lane of lanes.protocol_release ?? []) {
    pushSingle("protocol_release", lane.eventTimeUtc, "github_releases", "protocol_release", lane);
  }

  for (const lane of lanes.blockchain_network_stats ?? []) {
    pushSingle(
      "blockchain_network_stats",
      lane.eventTimeUtc,
      lane.providerId,
      "blockchain_network_stats",
      lane,
    );
  }

  for (const lane of lanes.regulatory_filing ?? []) {
    pushSingle("regulatory_filing", lane.eventTimeUtc, "sec_edgar", "regulatory_filing", lane);
  }

  if (lanes.mempool_stats) {
    const lane = lanes.mempool_stats;
    pushSingle("mempool_stats", lane.eventTimeUtc, "mempool_space", "mempool_stats", lane);
  }

  return timelines;
}

export function sidecarV3Lanes(
  lanes: Partial<Record<ReplayProviderSidecarLaneKey, ReplayProviderSidecarTimelineEntryV3[]>>,
): Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> {
  const timelines: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> = {};

  for (const laneKey of REPLAY_PROVIDER_SIDECAR_LANE_KEYS) {
    const entries = lanes[laneKey];
    if (!entries || entries.length === 0) {
      continue;
    }
    timelines[laneKey] = entries.map((entry) => ({
      eventTimeUtc: entry.eventTimeUtc,
      ingestTimeUtc: entry.ingestTimeUtc,
      availableAtUtc: entry.availableAtUtc,
      providerId: entry.providerId,
      feedKind: entry.feedKind,
      sourceDigest: entry.sourceDigest,
      payload: entry.payload,
    }));
  }

  return timelines;
}

export function pitResolvedEntriesToLanes(
  resolved: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry | PitTimelineEntry[]>>,
): ReplayProviderSidecarLanesV2 {
  const lanes: ReplayProviderSidecarLanesV2 = {};

  const asSingle = (laneKey: ReplayProviderSidecarLaneKey) => {
    const entry = resolved[laneKey];
    if (!entry || Array.isArray(entry)) {
      return undefined;
    }
    return entry.payload;
  };

  const asArray = (laneKey: ReplayProviderSidecarLaneKey) => {
    const entry = resolved[laneKey];
    if (!entry) {
      return [];
    }
    if (Array.isArray(entry)) {
      return entry.map((item) => item.payload);
    }
    return [entry.payload];
  };

  lanes.fear_greed_index = asSingle(
    "fear_greed_index",
  ) as ReplayProviderSidecarLanesV2["fear_greed_index"];
  lanes.global_market_stats = asSingle(
    "global_market_stats",
  ) as ReplayProviderSidecarLanesV2["global_market_stats"];
  lanes.order_book_snapshot = asSingle(
    "order_book_snapshot",
  ) as ReplayProviderSidecarLanesV2["order_book_snapshot"];
  lanes.market_trades_snapshot = asSingle(
    "market_trades_snapshot",
  ) as ReplayProviderSidecarLanesV2["market_trades_snapshot"];
  lanes.news_event_cluster = asSingle(
    "news_event_cluster",
  ) as ReplayProviderSidecarLanesV2["news_event_cluster"];
  lanes.mempool_stats = asSingle("mempool_stats") as ReplayProviderSidecarLanesV2["mempool_stats"];

  const cross = asArray("cross_exchange_confirmation");
  if (cross.length > 0) {
    lanes.cross_exchange_confirmation =
      cross as ReplayProviderSidecarLanesV2["cross_exchange_confirmation"];
  }

  const macroSeries = asArray("macro_series");
  if (macroSeries.length > 0) {
    lanes.macro_series = macroSeries as ReplayProviderSidecarLanesV2["macro_series"];
  }

  const macroCalendar = asArray("macro_calendar_event");
  if (macroCalendar.length > 0) {
    lanes.macro_calendar_event =
      macroCalendar as ReplayProviderSidecarLanesV2["macro_calendar_event"];
  }

  const macroProbability = asArray("macro_probability");
  if (macroProbability.length > 0) {
    lanes.macro_probability = macroProbability as ReplayProviderSidecarLanesV2["macro_probability"];
  }

  const newsHeadline = asArray("news_headline");
  if (newsHeadline.length > 0) {
    lanes.news_headline = newsHeadline as ReplayProviderSidecarLanesV2["news_headline"];
  }

  const exchangeAnnouncement = asArray("exchange_announcement");
  if (exchangeAnnouncement.length > 0) {
    lanes.exchange_announcement =
      exchangeAnnouncement as ReplayProviderSidecarLanesV2["exchange_announcement"];
  }

  const protocolRelease = asArray("protocol_release");
  if (protocolRelease.length > 0) {
    lanes.protocol_release = protocolRelease as ReplayProviderSidecarLanesV2["protocol_release"];
  }

  const blockchainStats = asArray("blockchain_network_stats");
  if (blockchainStats.length > 0) {
    lanes.blockchain_network_stats =
      blockchainStats as ReplayProviderSidecarLanesV2["blockchain_network_stats"];
  }

  const regulatoryFiling = asArray("regulatory_filing");
  if (regulatoryFiling.length > 0) {
    lanes.regulatory_filing = regulatoryFiling as ReplayProviderSidecarLanesV2["regulatory_filing"];
  }

  return lanes;
}
