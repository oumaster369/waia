# M1 Trade Lifecycle Model — DESIGN

**Linear:** DEE-376 · **Branch:** `dee-376-m1-trade-lifecycle` · **Semantics:** `TRADE_LIFECYCLE_SEMANTICS_VERSION_V2`

## Objective

First-class persisted round-trip entities (`Trade`, `PositionLot`, `TradeLeg`, `LifecycleEvent`) with FIFO spot long-only pairing, preserving all M0 closed-trade semantics.

## §3A Position vs Trade

| Entity | Role |
|--------|------|
| **PositionLot** | Live exposure (`remainingQty`, `avgCost`); M3 Guardian monitor target |
| **Trade** | Round-trip knowledge record; terminal rows frozen (`frozenAt`) |

TradeLeg rows are append-only. Trade lineage fields set at open; only operational fields mutate while `OPEN`.

## §3B Direction-agnostic reservations

`positionSide` (default `LONG`), `instrumentKind` (default `SPOT`), `hedgeGroupId?`, `venue`, `accountKey` — populated with M1 defaults; schema ready for SHORT/derivatives.

## §3C Guardian extension points

- Monitor: `PositionLot` where `state=OPEN`
- Reserved phases: `GUARDIAN_EVALUATED`, `GUARDIAN_EXIT_INTENT`
- Reserved: `targetLotId?` on PositionLot

## §3D / §3E Lineage & world state

Nullable columns on `trader_trades` for hypothesis/pattern/decision/MSV/regime refs. M1 populates signal/order-available fields only.

## Pairing policy

FIFO per `(organizationId, symbol, strategySignalId, positionSide, accountKey)`.

## M0 compatibility

- `CLOSED_TRADE_SEMANTICS_VERSION` unchanged
- M0 forensic test preserved
- Fill-walk derivation remains fallback when lifecycle repo absent
- Forced-flat synthetic legs use `TradeLegKind.FORCED_FLAT` (never `trader_fills`)

## Module layout

`lib/trader/lifecycle/*` — types, pairing, derive, recorder, repositories.

## Tables

`trader_trades`, `trader_position_lots`, `trader_trade_legs`, `trader_lifecycle_events` (Postgres + SQLite mirror, RLS on Postgres).
