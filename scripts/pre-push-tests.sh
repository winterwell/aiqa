#!/usr/bin/env bash
# Pre-push: run server and webapp test suites. Invoked by pre-commit (hook type pre-push).
# Run from repo root (aiqa).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server" && pnpm test
cd "$ROOT/webapp" && pnpm test
