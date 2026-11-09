#!/usr/bin/env python3
"""Initialize the verified local account in AppFlowy using the normal client API."""
import json,pathlib,urllib.request,urllib.error,urllib.parse
root=pathlib.Path(__file__).resolve().parent
values=dict(l.split('=',1) for l in (root/'.env').read_text().splitlines() if '=' in l)
session=json.loads((root/'.desktop-bootstrap-session.json').read_text())
origin=values['SERVER_ORIGIN'].rstrip('/')
request=urllib.request.Request(origin+'/api/user/verify/'+urllib.parse.quote(session['access_token'],safe=''))
try:
    with urllib.request.urlopen(request,timeout=30) as response: result=json.load(response)
except urllib.error.HTTPError as error:
    print(json.dumps({'verified':False,'http_status':error.code}));raise SystemExit(1)
if result.get('code')!=0:
    print(json.dumps({'verified':False,'api_code':result.get('code')}));raise SystemExit(1)
print(json.dumps({'verified':True,'is_new':result.get('data',{}).get('is_new')}))