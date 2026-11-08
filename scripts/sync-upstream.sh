#!/usr/bin/env bash
# Merge an upstream MarkEdit-preview release into this fork.
#
# Usage: scripts/sync-upstream.sh [tag]
#   tag defaults to the newest upstream release tag, e.g. v1.14.2
#
# Resolves the conflicts every upstream release causes:
#   - dist/: upstream's build output is named markedit-preview.js, this fork's
#     is markedit-preview-obsidian.js; dist/ is rebuilt after merging anyway
#   - package.json: upstream's file is taken, then this fork's fields are reapplied
# Any other conflict aborts the merge and exits with 2, listing the files.
#
# Exit codes: 0 merged (staged and committed), 2 conflicts, 3 already up to date.
set -euo pipefail

UPSTREAM_URL=https://github.com/MarkEdit-app/MarkEdit-preview.git
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
git fetch --quiet upstream --tags

# Release tags only, e.g. v1.14.2, not this fork's v1.14.2-obsidian.1
TAG=${1:-$(git tag -l 'v[0-9]*' --sort=-v:refname | grep -v -- '-' | head -1)}
VERSION=${TAG#v}
CURRENT=$(node -p "require('./package.json').version.split('-obsidian')[0]")

NEWEST=$(printf '%s\n%s\n' "$CURRENT" "$VERSION" | sort -V | tail -1)
if [ "$VERSION" = "$CURRENT" ] || [ "$NEWEST" = "$CURRENT" ]; then
  echo "Already on upstream $CURRENT, nothing to merge for $TAG."
  exit 3
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi

echo "Merging upstream $TAG into $(git branch --show-current) (currently based on $CURRENT)..."
git merge --quiet --no-commit --no-ff "$TAG" || true

unresolved=()
for file in $(git diff --name-only --diff-filter=U); do
  case "$file" in
    dist/*markedit-preview-obsidian.js) git checkout --ours -- "$file" && git add "$file" ;;
    dist/*) git rm --quiet -- "$file" ;;
    package.json) git checkout --theirs -- package.json && git add package.json ;;
    *) unresolved+=("$file") ;;
  esac
done

if [ ${#unresolved[@]} -gt 0 ]; then
  git merge --abort
  echo "Conflicts that need a manual merge:" >&2
  printf '%s\n' "${unresolved[@]}"
  exit 2
fi

# Upstream's build files never belong in this fork
git rm --quiet --ignore-unmatch dist/markedit-preview.js dist/lite/markedit-preview.js

# Reapply this fork's identity on top of upstream's package.json
node - "$VERSION" <<'EOF'
const fs = require('fs');
const upstream = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const fork = {
  name: 'markedit-preview-obsidian',
  version: `${process.argv[2]}-obsidian.1`,
  description: 'Markdown preview for MarkEdit, with Obsidian flavored markdown. Fork of MarkEdit-preview.',
  homepage: 'https://github.com/astrawrld/MarkEdit-preview-obsidian',
};
const { name, version, description, homepage, ...rest } = upstream;
fs.writeFileSync('package.json', JSON.stringify({ ...fork, ...rest }, null, 2) + '\n');
EOF
git add package.json

git commit --quiet --no-edit -m "Merge upstream $TAG"
echo "Merged $TAG as $VERSION-obsidian.1. Next: yarn install && yarn test, then rebuild dist/."
