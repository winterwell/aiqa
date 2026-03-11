#!/bin/bash
# Build and push winterstein/aiqa-server and winterstein/aiqa-webapp to Docker Hub.
# Run from aiqa/ directory. Requires: docker login -u winterstein

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(cat VERSION.txt | tr -d '[:space:]')
if [[ -z "$VERSION" ]]; then
  echo "VERSION.txt is empty or missing" >&2
  exit 1
fi

IMAGE_SERVER="winterstein/aiqa-server:$VERSION"
IMAGE_WEBAPP="winterstein/aiqa-webapp:$VERSION"

echo "Building and pushing with version $VERSION"

echo "Building $IMAGE_SERVER ..."
docker build -f Dockerfile.server -t "$IMAGE_SERVER" .

echo "Building $IMAGE_WEBAPP ..."
docker build -f Dockerfile.nginx -t "$IMAGE_WEBAPP" .

echo "Pushing $IMAGE_SERVER ..."
docker push "$IMAGE_SERVER"

echo "Pushing $IMAGE_WEBAPP ..."
docker push "$IMAGE_WEBAPP"

echo "Done. Published $IMAGE_SERVER and $IMAGE_WEBAPP"
