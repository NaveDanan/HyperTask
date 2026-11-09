#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ $# == 3 ]] || { printf 'Usage: %s <certificate-chain.pem> <private-key.pem> <https://server:8443>\n' "$0" >&2; exit 2; }
umask 077
mkdir -p .tls
chmod 700 .tls
install -m 600 "$1" .tls/certificate.pem
install -m 600 "$2" .tls/private-key.pem
openssl x509 -in .tls/certificate.pem -pubkey -noout > .tls/cert-public.pem
openssl pkey -in .tls/private-key.pem -pubout > .tls/key-public.pem
cmp -s .tls/cert-public.pem .tls/key-public.pem || { printf 'The certificate and private key do not match.\n' >&2; exit 1; }
server_host=$(python3 - "$3" <<'PY'
import sys, urllib.parse
u=urllib.parse.urlparse(sys.argv[1]);h=(u.hostname or '').lower().rstrip('.')
if u.scheme!='https' or not h or u.username or u.password or u.path not in ('','/') or u.query or u.fragment or any(h==d or h.endswith('.'+d) for d in ('appflowy.com','appflowy.io','appflowy.cloud')):
    raise SystemExit('Enter your HTTPS server origin without credentials or a path.')
print(h)
PY
)
openssl x509 -in .tls/certificate.pem -noout -checkhost "$server_host"
cp -- .env .tls/config-before-tls.env
python3 - "$3" <<'PY'
import pathlib,sys,urllib.parse
origin=sys.argv[1].rstrip('/');u=urllib.parse.urlparse(origin)
p=pathlib.Path('.env');v=dict(l.split('=',1) for l in p.read_text().splitlines() if '=' in l);v['SERVER_ORIGIN']=origin;v['TLS_PORT']=str(u.port or 443);p.write_text(''.join(k+'='+x+'\n' for k,x in v.items()));p.chmod(0o600)
s=pathlib.Path('nginx.conf').read_text().replace('listen 80;','listen 443 ssl;\n    ssl_certificate /etc/nginx/tls/certificate.pem;\n    ssl_certificate_key /etc/nginx/tls/private-key.pem;')
pathlib.Path('nginx.tls.conf').write_text(s)
PY
docker compose -f compose.yaml -f compose.tls.yaml config --quiet
docker compose -f compose.yaml -f compose.tls.yaml up -d --no-build
printf '%s\n' enabled > .tls/enabled
printf 'TLS enabled at %s. Clients must trust the certificate issuer; certificate verification stays enabled.\n' "$3"