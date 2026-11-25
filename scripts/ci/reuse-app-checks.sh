#!/usr/bin/env bash
set -euo pipefail

# A squash or merge can change the commit SHA without changing the tested tree.
# Match metadata from a completed PR run. Never download or execute PR artifacts.
find_verified_pr() {
  local first_parent tree pr head merged_at run run_id attempt artifact
  [[ "${SELECTION_DIGEST:-}" =~ ^[0-9a-f]{64}$ ]] || return 1
  first_parent=$(git rev-parse "$GITHUB_SHA^") || return 1
  [[ "$first_parent" == "$BEFORE_SHA" ]] || return 1
  tree=$(git rev-parse "$GITHUB_SHA^{tree}") || return 1

  pr=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" |
    jq -ec --arg sha "$GITHUB_SHA" --arg repo "$GITHUB_REPOSITORY" '
      [.[] | select(.base.ref == "develop" and .base.repo.full_name == $repo
        and .head.repo.full_name == $repo and .merged_at != null and .merge_commit_sha == $sha)]
      | select(length == 1) | .[0]') || return 1
  head=$(jq -r '.head.sha' <<< "$pr") || return 1
  merged_at=$(jq -r '.merged_at' <<< "$pr") || return 1

  run=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs" \
    -f event=pull_request -f head_sha="$head" -F per_page=1 |
    jq -ec --arg merged "$merged_at" '
      .workflow_runs[0] | select(.conclusion == "success" and .updated_at <= $merged)') || return 1
  run_id=$(jq -r '.id' <<< "$run") || return 1
  attempt=$(jq -r '.run_attempt' <<< "$run") || return 1
  artifact="verified-dev-pr-$(jq -r '.number' <<< "$pr")-$BEFORE_SHA-$tree-$attempt-$SELECTION_DIGEST"
  gh api --method GET "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/artifacts" -f name="$artifact" |
    jq -e --arg name "$artifact" 'any(.artifacts[]; .name == $name and .expired == false)' > /dev/null || return 1
  printf 'Reusing app checks from PR workflow run %s for Git tree %s.\n' "$run_id" "$tree"
}

if find_verified_pr; then
  echo 'verified=true' >> "$GITHUB_OUTPUT"
else
  echo 'PR verification unavailable for this push. Running app checks.'
  echo 'verified=false' >> "$GITHUB_OUTPUT"
fi
