#!/bin/sh
# Merge the latest MarkEdit-preview release into this fork.
set -e

UPSTREAM=https://github.com/MarkEdit-app/MarkEdit-preview.git
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM"
git fetch upstream --tags

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi

git merge --no-edit upstream/main
echo
echo "Merged. Next:"
echo "  1. Bump \"version\" in package.json to <upstream version>-obsidian.1"
echo "  2. yarn install && yarn test && yarn build"
