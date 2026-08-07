#!/usr/bin/env bash
# Canonical FHV artifact identity filenames (WP-2).
#
# Single source of truth shared by the writer (record-fhv-artifact-identity.sh) and every
# reader (snapshot-fhv-full-corpus-failure-evidence.sh). These names drifted apart once — the
# writer emitted FINAL_HEAD.txt / artifact-identity.v1.json while the snapshot looked for
# FINAL_HEAD / fhv-artifact-identity.v1.json — so every published full-corpus failure artifact
# lost its FINAL_HEAD / EXECUTED_SHA / BASE_SHA binding. Change these in one place only.

FHV_IDENTITY_FINAL_HEAD_FILE="FINAL_HEAD.txt"
FHV_IDENTITY_EXECUTED_SHA_FILE="EXECUTED_SHA.txt"
FHV_IDENTITY_BASE_SHA_FILE="BASE_SHA.txt"
FHV_IDENTITY_MANIFEST_FILE="artifact-identity.v1.json"

# Pre-WP-2 extensionless names, accepted on read so older artifact roots stay diagnosable.
FHV_IDENTITY_LEGACY_FINAL_HEAD_FILE="FINAL_HEAD"
FHV_IDENTITY_LEGACY_EXECUTED_SHA_FILE="EXECUTED_SHA"
FHV_IDENTITY_LEGACY_BASE_SHA_FILE="BASE_SHA"
FHV_IDENTITY_LEGACY_MANIFEST_FILE="fhv-artifact-identity.v1.json"
