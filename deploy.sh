#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/var/log/f1-clock-deploy.log"
LOCK_FILE="/tmp/f1-clock-deploy.lock"
BRANCH="main"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Prevent overlapping runs via flock (kernel releases lock if process dies)
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    exit 0
fi

cd "$REPO_DIR"

OLD_HEAD=$(git rev-parse HEAD)

git pull origin "$BRANCH" --ff-only >> "$LOG_FILE" 2>&1 || {
    log "ERROR: git pull failed"
    exit 1
}

NEW_HEAD=$(git rev-parse HEAD)

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    exit 0
fi

log "New commits: $OLD_HEAD -> $NEW_HEAD"
log "$(git log --oneline "${OLD_HEAD}..${NEW_HEAD}")"
log "Rebuilding..."

docker compose up -d --build >> "$LOG_FILE" 2>&1

log "Deploy complete"
