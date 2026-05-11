# ADR-0004 — Additive governance evolution for WAIA DEV OS

Status: Accepted  
Date: 2026-05-07

## Context

Historical agent/docs drift emerged (commands vs rules vs `AGENTS`).**Rewriting aggressively risked contradictory sources mid-migration.**

## Decision

Layer governance **additively**: publish `docs/waia-governance/**` canon + lightweight ADRs, then mechanically align tooling PRs.**Supersede via explicit ADR + versioning note** instead of silent deletion.

## Consequences

+ Safer multi-step adoption − Temporary overlap until Batch alignment Neutral: Requires discipline to finish alignment waves

## Links

- [`../waia-governance/GOVERNANCE-VERSIONING.md`](../waia-governance/GOVERNANCE-VERSIONING.md)
