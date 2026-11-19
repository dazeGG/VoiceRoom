#!/usr/bin/env bash
set -euo pipefail

tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
export PATH="$tmp:$PATH" GITHUB_OUTPUT="$tmp/output"
export GITHUB_REPOSITORY=example/VoiceRoom
export GITHUB_SHA
GITHUB_SHA=$(git rev-parse HEAD)
export BEFORE_SHA
BEFORE_SHA=$(git rev-parse HEAD^)
tree=$(git rev-parse 'HEAD^{tree}')
export PROOF="verified-dev-pr-12-$BEFORE_SHA-$tree-2"
export SCENARIO=valid

cat > "$tmp/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"/commits/$GITHUB_SHA/pulls")
    if [[ "$SCENARIO" == 'direct-push' ]]; then
      echo '[]'
    else
      jq -n --arg sha "$GITHUB_SHA" --arg repo "$GITHUB_REPOSITORY" '
        [{number: 12, merge_commit_sha: $sha, merged_at: "2026-11-19T08:00:00Z",
          base: {ref: "develop", repo: {full_name: $repo}},
          head: {sha: "pr-head", repo: {full_name: $repo}}}]'
    fi
    ;;
  *'/actions/workflows/ci.yml/runs -f event=pull_request -f head_sha=pr-head -F per_page=1')
    conclusion=success
    if [[ "$SCENARIO" == 'failed-ci' ]]; then conclusion=failure; fi
    jq -n --arg conclusion "$conclusion" '
      {workflow_runs: [{id: 15, run_attempt: 2, conclusion: $conclusion, updated_at: "2026-11-19T07:59:00Z"}]}'
    ;;
  *"/actions/runs/15/artifacts -f name=$PROOF")
    name=$PROOF
    expired=false
    case "$SCENARIO" in
      different-tree) name="verified-dev-pr-12-$BEFORE_SHA-different-tree-2" ;;
      old-attempt) name="${PROOF%-2}-1" ;;
      expired) expired=true ;;
      api-error) exit 1 ;;
    esac
    jq -n --arg name "$name" --argjson expired "$expired" '{artifacts: [{name: $name, expired: $expired}]}'
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$tmp/gh"

check() {
  SCENARIO=$1
  : > "$GITHUB_OUTPUT"
  bash scripts/ci/reuse-app-checks.sh
  test "$(cat "$GITHUB_OUTPUT")" = "verified=$2"
}

check valid true
for scenario in direct-push failed-ci different-tree old-attempt expired api-error; do
  check "$scenario" false
done
BEFORE_SHA=unexpected-parent
check valid false
