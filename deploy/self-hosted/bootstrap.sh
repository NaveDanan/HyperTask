#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
umask 077
docker compose version >/dev/null
docker info >/dev/null
if [[ ! -f .env ]]; then
  server_origin=${1:-http://collaboration.example.com:8080}
  python3 - "$server_origin" <<'PY'
import secrets,sys,urllib.parse,pathlib
u=urllib.parse.urlparse(sys.argv[1]);h=(u.hostname or '').lower().rstrip('.')
if u.scheme not in ('http','https') or not h or u.username or u.password or u.path not in ('','/') or u.query or u.fragment or any(h==d or h.endswith('.'+d) for d in ('appflowy.com','appflowy.io','appflowy.cloud')):
    raise SystemExit('Use an HTTP(S) origin on your own host without credentials or a path.')
values={'SERVER_ORIGIN':sys.argv[1].rstrip('/'),'HTTP_PORT':str(u.port or (443 if u.scheme=='https' else 80)),'BIND_ADDRESS':'0.0.0.0','POSTGRES_PASSWORD':secrets.token_hex(32),'JWT_SECRET':secrets.token_hex(48),'S3_SECRET':secrets.token_hex(32)}
p=pathlib.Path('.env');p.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));p.chmod(0o600)
PY
fi
chmod 600 .env
python3 - <<'PY'
import json,pathlib
values=dict(l.split('=',1) for l in pathlib.Path('.env').read_text().splitlines() if '=' in l)
p=pathlib.Path('.s3.json');p.write_text(json.dumps({'identities':[{'name':'appflowy','credentials':[{'accessKey':'appflowy_storage','secretKey':values['S3_SECRET']}],'actions':['Admin','Read','Write','List','Tagging']}]}));p.chmod(0o600)
PY
compose=(docker compose)
if [[ -f .tls/enabled ]]; then compose+=(-f compose.yaml -f compose.tls.yaml); fi
"${compose[@]}" config --quiet
"${compose[@]}" pull postgres redis minio gotrue appflowy_cloud admin_frontend nginx
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 postgres redis minio
"${compose[@]}" exec -T postgres psql -U appflowy -d appflowy -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS auth;"
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 gotrue appflowy_cloud admin_frontend nginx
./manage.sh health