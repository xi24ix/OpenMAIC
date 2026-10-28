#!/usr/bin/env bash
# Drive one full lesson generation against a running OpenMAIC server and
# report the run's step outcomes. Usage:
#
#   scripts/test-lesson-generation.sh [base_url] [requirement]
#
# Uses single-user/anonymous identity: whatever owner the server resolves for
# this shell is used, exactly like a browser session would.
set -euo pipefail

BASE="${1:-http://localhost:4310}"
REQUIREMENT="${2:-Teach the water cycle to a 10 year old in English, with one scene}"
MAX_SCENES="${MAX_SCENES:-1}"

echo "== health =="
curl -sf "$BASE/api/health" | jq -c '.'

echo "== start run =="
RUN_JSON="$(curl -sf -X POST "$BASE/api/generation-runs" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg req "$REQUIREMENT" --argjson scenes "$MAX_SCENES" '
    {requirement: $req, outlineReview: "auto", maxScenes: $scenes, interactive: true, taskEngine: false}')")"
RUN_ID="$(echo "$RUN_JSON" | jq -r '.run.id // .run.runId // empty')"
echo "run id: $RUN_ID"
[ -n "$RUN_ID" ] || { echo "$RUN_JSON" | jq .; exit 1; }

echo "== poll =="
for i in $(seq 1 120); do
  sleep 10
  SNAP="$(curl -sf "$BASE/api/generation-runs/$RUN_ID")"
  STATE="$(echo "$SNAP" | jq -r '.run.state // .run.status // "?"')"
  STEP="$(echo "$SNAP" | jq -r '.run.currentStep // .run.step // "-"' 2>/dev/null || true)"
  echo "[$((i*10))s] state=$STATE step=$STEP"
  case "$STATE" in
    completed|ended|failed|paused) break ;;
  esac
done

echo "== final snapshot (trimmed) =="
curl -sf "$BASE/api/generation-runs/$RUN_ID" | jq '.run | {id, state, step, progress, error}' 2>/dev/null \
  || curl -sf "$BASE/api/generation-runs/$RUN_ID" | head -c 4000
echo
echo "== events =="
curl -sf "$BASE/api/generation-runs/$RUN_ID" | jq -r '.run.events[]? | "\(.type // .kind): \(.message // .detail // "")"' 2>/dev/null | tail -30 || true
