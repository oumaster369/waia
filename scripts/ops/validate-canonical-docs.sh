#!/usr/bin/env bash
# Validate frontmatter and required sections for canonical doc types:
#   - docs/plans/dee-*.md (excluding README and archive/)
#   - docs/product-specs/*.md (excluding README)
#   - docs/gaps/*.md (excluding README and *STANDARD*)
#   - docs/roadmaps/*.md (excluding README and *STANDARD*)
#
# Usage:
#   ./scripts/ops/validate-canonical-docs.sh [path ...]
#
# With no args, validates all tracked canonical docs + templates.
# Exit 0 = pass, 1 = validation failure, 2 = usage error.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAIL=0
CHECKED=0

usage() {
  cat >&2 <<'EOF'
Usage: ./scripts/ops/validate-canonical-docs.sh [path ...]

Validates YAML frontmatter keys and required ## sections for WAIA canonical docs.
EOF
}

fail() {
  echo "FAIL: $1" >&2
  FAIL=1
}

# Extract frontmatter block (between first two --- lines). Prints to stdout.
extract_frontmatter() {
  local file="$1"
  awk 'BEGIN { fm=0 } /^---$/ { fm++; if (fm==1) next; if (fm==2) exit; next } fm==1 { print }' "$file"
}

# Return 0 if frontmatter contains "key:" (top-level YAML key).
fm_has_key() {
  local fm="$1"
  local key="$2"
  grep -Eq "^${key}:" <<<"$fm"
}

# Return 0 if file body contains "## SectionName" heading.
body_has_section() {
  local file="$1"
  local section="$2"
  grep -Eq "^## ${section}" "$file"
}

require_fm_keys() {
  local file="$1"
  local label="$2"
  shift 2
  local keys=("$@")
  local fm
  fm="$(extract_frontmatter "$file")"
  if [[ -z "$fm" ]]; then
    fail "$label $file — missing YAML frontmatter (--- ... ---)"
    return
  fi
  local key
  for key in "${keys[@]}"; do
    if ! fm_has_key "$fm" "$key"; then
      fail "$label $file — frontmatter missing key: $key"
    fi
  done
}

require_sections() {
  local file="$1"
  local label="$2"
  shift 2
  local sections=("$@")
  local section
  for section in "${sections[@]}"; do
    if ! body_has_section "$file" "$section"; then
      fail "$label $file — missing required section: ## $section"
    fi
  done
}

# Integration plans may use either:
#   - ## Acceptance
#   - ## WP-* (top-level work packages)
#   - ### WP-* (nested work packages under a Gate / program heading, e.g. DEE-518)
plan_has_wp_structure() {
  local file="$1"
  grep -Eq '^## WP-' "$file" || grep -Eq '^### WP-' "$file"
}

validate_plan() {
  local file="$1"
  CHECKED=$((CHECKED + 1))
  require_fm_keys "$file" "plan" \
    integrationIssue integrationTitle branch riskTier prPolicy executionSurfaces \
    requiredValidation approvalGates state provenance
  if ! body_has_section "$file" "Acceptance" && ! plan_has_wp_structure "$file"; then
    fail "plan $file — missing ## Acceptance or ## WP-* / ### WP-* section"
  fi
}

# Human ratification addenda / plan amendments are NOT integration plans.
# Narrow filename class only: dee-<NN>-<slug>-(addendum|amendment)-vN.md
# Do not require full integration-plan frontmatter or WP structure.
validate_plan_addendum() {
  local file="$1"
  CHECKED=$((CHECKED + 1))
  if ! grep -Eq '^## ' "$file"; then
    fail "plan-addendum $file — missing ## heading (ratification/amendment body required)"
  fi
  local fm
  fm="$(extract_frontmatter "$file")"
  if [[ -n "$fm" ]]; then
    if ! fm_has_key "$fm" "kind"; then
      fail "plan-addendum $file — frontmatter present but missing key: kind"
      return
    fi
    if ! grep -Eq '^kind:[[:space:]]*(ratification-addendum|plan-amendment)[[:space:]]*$' <<<"$fm"; then
      fail "plan-addendum $file — kind must be ratification-addendum or plan-amendment"
    fi
  fi
}

validate_product_spec() {
  local file="$1"
  CHECKED=$((CHECKED + 1))
  require_fm_keys "$file" "product-spec" \
    specId title module maturity owner sourceOfTruth lastReviewed version
  require_sections "$file" "product-spec" \
    Purpose Scope "Out of scope" "Acceptance criteria" Dependencies Traceability
}

validate_gap_registry() {
  local file="$1"
  CHECKED=$((CHECKED + 1))
  require_fm_keys "$file" "gap-registry" \
    registryId title scope owner lastReviewed version
  require_sections "$file" "gap-registry" \
    Purpose "Gap entries" "Intake rules" "Resolution workflow" Traceability
}

validate_roadmap() {
  local file="$1"
  CHECKED=$((CHECKED + 1))
  require_fm_keys "$file" "roadmap" \
    roadmapId title horizon owner lastReviewed version
  require_sections "$file" "roadmap" \
    Purpose "Integration batches" "Batch schema" Dependencies Traceability
}

classify_and_validate() {
  local file="$1"
  local rel="${file#"$ROOT"/}"
  local base
  base="$(basename "$file")"

  case "$rel" in
    docs/plans/archive/* | docs/plans/README.md)
      return 0
      ;;
  esac

  # Filename class is checked before the general dee-*.md integration-plan class.
  # Basename matching lets the regression harness pass fixtures outside docs/plans/.
  case "$base" in
    dee-*-addendum-*.md | dee-*-amendment-*.md)
      validate_plan_addendum "$file"
      return 0
      ;;
    dee-*.md)
      validate_plan "$file"
      return 0
      ;;
  esac

  case "$rel" in
    docs/product-specs/README.md)
      return 0
      ;;
    docs/product-specs/*.md)
      validate_product_spec "$file"
      ;;
    docs/gaps/README.md | docs/gaps/*STANDARD*.md)
      return 0
      ;;
    docs/gaps/*.md)
      validate_gap_registry "$file"
      ;;
    docs/roadmaps/README.md | docs/roadmaps/*STANDARD*.md)
      return 0
      ;;
    docs/roadmaps/*.md)
      validate_roadmap "$file"
      ;;
    *)
      echo "skip: unrecognized canonical path $rel" >&2
      ;;
  esac
}

collect_defaults() {
  find "$ROOT/docs/plans" -maxdepth 1 -name 'dee-*.md' -type f 2>/dev/null || true
  find "$ROOT/docs/product-specs" -maxdepth 1 -name '*.md' -type f 2>/dev/null || true
  find "$ROOT/docs/gaps" -maxdepth 1 -name '*.md' -type f 2>/dev/null || true
  find "$ROOT/docs/roadmaps" -maxdepth 1 -name '*.md' -type f 2>/dev/null || true
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  local files=()
  if [[ $# -gt 0 ]]; then
    files=("$@")
  else
    while IFS= read -r f; do
      [[ -n "$f" ]] && files+=("$f")
    done < <(collect_defaults)
  fi

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "warn: no canonical docs found to validate" >&2
    exit 0
  fi

  local file
  for file in "${files[@]}"; do
    if [[ ! -f "$file" ]]; then
      fail "file not found: $file"
      continue
    fi
    classify_and_validate "$file"
  done

  echo "validate-canonical-docs: checked $CHECKED file(s)"
  if [[ $FAIL -ne 0 ]]; then
    exit 1
  fi
}

main "$@"
