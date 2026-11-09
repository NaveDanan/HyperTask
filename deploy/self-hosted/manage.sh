#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
compose=(docker compose)
if [[ -f .tls/enabled ]]; then compose+=(-f compose.yaml -f compose.tls.yaml); fi
case ${1:-status} in
  status) "${compose[@]}" ps ;;
  health)
    server_origin=$(python3 -c "from pathlib import Path;print(dict(l.split('=',1) for l in Path('.env').read_text().splitlines() if '=' in l)['SERVER_ORIGIN'])")
    "${compose[@]}" ps
    for endpoint in /healthz /gotrue/health /health /api/server; do
      curl --fail --silent --show-error --max-time 10 --retry 10 --retry-connrefused --retry-delay 1 --retry-all-errors "${server_origin%/}$endpoint"
      printf '\n'
    done
    ;;
  logs) "${compose[@]}" logs --tail 80 "${2:-appflowy_cloud}" ;;
  start) "${compose[@]}" up -d --no-build ;;
  stop) "${compose[@]}" stop ;;
  backup)
    umask 077
    mkdir -p backups
    backup_date=$(date -u +%Y%m%dT%H%M%SZ)
    "${compose[@]}" stop appflowy_cloud gotrue minio
    trap '"${compose[@]}" start minio gotrue appflowy_cloud >/dev/null' EXIT
    "${compose[@]}" exec -T postgres pg_dump -U appflowy -d appflowy -Fc > "backups/database-$backup_date.dump"
    docker run --rm --network none --volumes-from appflowy-demo-minio-1:ro --entrypoint tar nginx:1.26.3-alpine@sha256:1eadbb07820339e8bbfed18c771691970baee292ec4ab2558f1453d26153e22d -C /data -czf - . > "backups/files-$backup_date.tar.gz"
    cp -- .env "backups/config-$backup_date.env"
    chmod 600 "backups/config-$backup_date.env"
    printf 'Backup written to %s/backups (%s)\n' "$PWD" "$backup_date"
    ;;
  web)
    "${compose[@]}" --profile web build web
    "${compose[@]}" --profile web up -d --no-build web
    "${compose[@]}" exec -T nginx nginx -s reload
    ;;
  source-build) "${compose[@]}" -f compose.yaml -f compose.source.yaml build gotrue appflowy_cloud admin_frontend ;;
  *) printf 'Usage: %s {status|health|logs [service]|start|stop|backup|web|source-build}\n' "$0" >&2; exit 2 ;;
esac