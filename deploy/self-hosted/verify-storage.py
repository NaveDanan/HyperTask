#!/usr/bin/env python3
"""Verify the configured local S3 endpoint without printing credentials."""
import datetime, hashlib, hmac, json, pathlib, urllib.request, uuid
root = pathlib.Path(__file__).resolve().parent
values = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines() if '=' in line)
key = values['S3_SECRET']
origin = values['SERVER_ORIGIN'].rstrip('/')
region = 'us-east-1'
bucket = 'appflowy'
def request(method, resource, body=b''):
    now = datetime.datetime.now(datetime.timezone.utc)
    date = now.strftime('%Y%m%d')
    stamp = now.strftime('%Y%m%dT%H%M%SZ')
    digest = hashlib.sha256(body).hexdigest()
    headers = 'host:minio:9000\nx-amz-content-sha256:' + digest + '\nx-amz-date:' + stamp + '\n'
    signed = 'host;x-amz-content-sha256;x-amz-date'
    canonical = '\n'.join((method, resource, '', headers, signed, digest))
    scope = date + '/' + region + '/s3/aws4_request'
    data = '\n'.join(('AWS4-HMAC-SHA256', stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()))
    def sign(secret, content): return hmac.new(secret, content.encode(), hashlib.sha256).digest()
    secret = sign(sign(sign(sign(('AWS4' + key).encode(), date), region), 's3'), 'aws4_request')
    signature = hmac.new(secret, data.encode(), hashlib.sha256).hexdigest()
    auth = 'AWS4-HMAC-SHA256 Credential=appflowy_storage/' + scope + ', SignedHeaders=' + signed + ', Signature=' + signature
    req = urllib.request.Request(origin + '/minio-api' + resource, data=body if method == 'PUT' else None, method=method,
        headers={'Host': 'minio:9000', 'x-amz-date': stamp, 'x-amz-content-sha256': digest, 'Authorization': auth})
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.status, response.read()
request('HEAD', '/' + bucket)
resource = '/' + bucket + '/readiness/' + str(uuid.uuid4()) + '.txt'
payload = b'AppFlowy DEMO local object storage readiness\n'
request('PUT', resource, payload)
try:
    status, result = request('GET', resource)
    if result != payload: raise RuntimeError('Object storage returned different content')
finally:
    request('DELETE', resource)
print(json.dumps({'bucket_exists': True, 'put_get_delete_roundtrip': True, 'bytes': len(payload)}))