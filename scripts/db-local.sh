#!/usr/bin/env bash
# Project-local Postgres cluster in .data/pg on port 5433, so the system
# Postgres install is left untouched.
set -euo pipefail
export LC_ALL=C LANG=C

cd "$(dirname "$0")/.."
DATA_DIR=".data/pg"
PORT=5433
DB=moneyprinter

case "${1:-}" in
  start)
    if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
      mkdir -p "$DATA_DIR"
      initdb -D "$DATA_DIR" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
    fi
    if ! pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
      pg_ctl -D "$DATA_DIR" -o "-p $PORT -k /tmp" -l .data/pg.log start >/dev/null
      until pg_isready -h localhost -p "$PORT" >/dev/null 2>&1; do sleep 0.2; done
    fi
    psql -h localhost -p "$PORT" -U postgres -tc "select 1 from pg_database where datname='$DB'" | grep -q 1 \
      || createdb -h localhost -p "$PORT" -U postgres "$DB"
    echo "postgres://postgres@localhost:$PORT/$DB"
    ;;
  stop)
    pg_ctl -D "$DATA_DIR" stop
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 1
    ;;
esac
