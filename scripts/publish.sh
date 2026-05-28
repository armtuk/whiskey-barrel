#!/bin/bash
set -euo pipefail

PACKAGE_NAME=$(node -p "require('./package.json').name")
LOCAL_VERSION=$(node -p "require('./package.json').version")

REMOTE_VERSION=$(npm view "$PACKAGE_NAME" version 2>/dev/null || echo "")

if [ -z "$REMOTE_VERSION" ]; then
  echo "Package not yet published — publishing $LOCAL_VERSION"
elif [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ]; then
  echo "Local version $LOCAL_VERSION matches published version — bumping patch"
  npm version patch --no-git-tag-version
  LOCAL_VERSION=$(node -p "require('./package.json').version")
  echo "Bumped to $LOCAL_VERSION"
else
  echo "Local version $LOCAL_VERSION differs from published $REMOTE_VERSION — publishing as-is"
fi

pnpm publish --access public --no-git-checks
echo "Published $PACKAGE_NAME@$LOCAL_VERSION"
