# ADR-0033 — AI-TWIN memory retention and experience legacy

**Status:** Proposed — Human-approved 2026-09-08; accepted on merge
**Date:** 2026-09-08
**Linear:** DEE-965 / DEE-871

## Context

The Human approved bounded working-memory retention, then clarified that lived experience must be inheritable. Applying one global TTL loses selected life experience; interpreting append-only history as permanent storage removes Human control. Neither result matches the approved purpose.

## Decision

Use three independently purpose-controlled layers: bounded working memory, deliberately maintained private personal memory, and selected inheritable experience with no automatic TTL. Preserve contextual evidence and Human reinterpretations, not a purported complete personality. Integrate the exact approved durations and their anchors into [Canonical Algorithm sections 6.1–6.3](../ai-twin/AI-TWIN-CANONICAL-ALGORITHM.md), the single current algorithm canon.

Ordinary revision preserves history; rights-driven removal may erase historical personal content and derivatives. No silent archive promotion or relabelling to evade deletion. Storage permission never implies modelling, sharing, postmortem delivery or common-knowledge contribution. V1's private format does not authorize inheritance transfer. Twelve-month receipt retention remains conditional; 7/30-day erasure targets require operational proof before promise or rollout.

## Consequences

- Separate permissions, provenance, lifecycle and tests are necessary. Expiry of raw dialogue does not automatically destroy independently authorized archived experience, nor automatically justify keeping a derived summary.
- The private archive can outlive rotating backups; restoration must respect subsequent removal.
- Future inheritance needs explicit directives, recipient/trigger verification, jurisdiction and third-party review; inactivity is not death.
- This decision refines ADR-0032's append-only semantics without replacing its sovereignty or authority boundaries. No biometric rule changes.
- Shared migration registration is deferred: at main 40669e6b Trader rejects applied hashes beyond its 204 boundary. DEE-965 changes no shared migration or runtime and cannot complete DEE-871.

## Rejected alternatives

Permanent retention of every message; silent preservation through summaries; automatic transfer of a whole Twin/account; treating storage consent as social consent; changing Trader's migration maximum within a Twin task.
