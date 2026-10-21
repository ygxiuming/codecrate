#!/bin/sh
# Prepares the bind-mounted data directory and then drops root privileges.
# Only the data paths are touched; the application itself runs as an unprivileged user.
set -eu

APP_USER="${APP_USER:-node}"
APP_UID="$(id -u "$APP_USER")"
APP_GID="$(id -g "$APP_USER")"

if [ "$(id -u)" = "0" ]; then
  DATA_DIR="${DATA_DIR:-/data}"
  STORAGE_DIR="${STORAGE_DIR:-$DATA_DIR/files}"

  mkdir -p "$DATA_DIR" "$STORAGE_DIR"

  # A host directory created by Docker is root-owned, which would make SQLite and
  # uploads fail for the app user. Recursive chown is skipped when ownership is
  # already correct so that large caches do not slow down every container start.
  for dir in "$DATA_DIR" "$STORAGE_DIR"; do
    if [ "$(stat -c '%u:%g' "$dir")" != "$APP_UID:$APP_GID" ]; then
      echo "entrypoint: setting ownership of $dir to ${APP_USER} (${APP_UID}:${APP_GID})" >&2
      chown -R "$APP_UID:$APP_GID" "$dir" || \
        echo "entrypoint: warning: could not change ownership of $dir; continuing" >&2
    fi
  done

  exec gosu "$APP_USER" "$@"
fi

exec "$@"
