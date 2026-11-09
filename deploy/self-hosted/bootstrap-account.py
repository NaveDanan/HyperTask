#!/usr/bin/env python3
"""Create a local desktop session without SMTP or printing credentials."""
import base64, datetime, hashlib, hmac, json, pathlib, sys, time, urllib.error, urllib.parse, urllib.request
root=pathlib.Path(__file__).resolve().parent
values=dict(l.split('=',1) for l in (root/'.env').read_text().splitlines() if '=' in l)
origin=values['SERVER_ORIGIN'].rstrip('/')
email=sys.argv[1]
def b64(value): return base64.urlsafe_b64encode(value).decode().rstrip('=')
now=int(time.time())
head=b64(json.dumps({'alg':'HS256','typ':'JWT'},separators=(',',':')).encode())
claims=b64(json.dumps({'aud':'authenticated','role':'service_role','iat':now,'exp':now+120,'sub':'00000000-0000-0000-0000-000000000000'},separators=(',',':')).encode())
message=head+'.'+claims
service_token=message+'.'+b64(hmac.new(values['JWT_SECRET'].encode(),message.encode(),hashlib.sha256).digest())
request=urllib.request.Request(origin+'/gotrue/admin/generate_link',data=json.dumps({'type':'magiclink','email':email,'redirect_to':origin+'/app'}).encode(),headers={'Authorization':'Bearer '+service_token,'Content-Type':'application/json'},method='POST')
try:
    with urllib.request.urlopen(request,timeout=20) as response: generated=json.load(response)
except urllib.error.HTTPError as error:
    print(json.dumps({'success':False,'stage':'generate_link','http_status':error.code}));raise SystemExit(1)
action=generated.get('action_link') or generated.get('properties',{}).get('action_link')
if not action: raise SystemExit('Local authentication API returned no action link')
u=urllib.parse.urlparse(action)
if (u.scheme,u.netloc)!=(urllib.parse.urlparse(origin).scheme,urllib.parse.urlparse(origin).netloc):
    raise SystemExit('Authentication link did not target this deployment')
# This GoTrue image emits /verify even behind the /gotrue reverse proxy.
if u.path == '/verify': action=urllib.parse.urlunparse(u._replace(path='/gotrue/verify'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(NoRedirect)
verified={}
try:
    with opener.open(action,timeout=20) as response:
        location=response.headers.get('Location','')
        content=response.read()
        try: verified=json.loads(content)
        except ValueError: verified={}
        if not location and not verified: print(json.dumps({'stage':'verify_body','status':response.status,'content_type':response.headers.get('Content-Type'),'action_path':u.path,'body_bytes':len(content)}))
except urllib.error.HTTPError as response:
    if response.code not in (301,302,303,307,308):
        print(json.dumps({'success':False,'stage':'verify','http_status':response.code}));raise SystemExit(1)
    location=response.headers.get('Location','')
parts=urllib.parse.parse_qs(urllib.parse.urlparse(location).fragment)
if verified.get('access_token') and verified.get('refresh_token'): parts={k:[str(v)] for k,v in verified.items() if k!='user'}
if 'access_token' not in parts or 'refresh_token' not in parts:
    print(json.dumps({'success':False,'stage':'verify_session','fragment_keys':list(parts),'query_keys':list(urllib.parse.parse_qs(urllib.parse.urlparse(location).query)),'error':parts.get('error'), 'error_description':parts.get('error_description')}))
    raise SystemExit(1)
session={key:value[0] for key,value in parts.items()}
session['expires_in']=int(session.get('expires_in','7200'))
session['expires_at']=now+session['expires_in']
user_request=urllib.request.Request(origin+'/gotrue/user',headers={'Authorization':'Bearer '+session['access_token']})
with urllib.request.urlopen(user_request,timeout=20) as response: user=json.load(response)
if user.get('email','').lower()!=email.lower(): raise SystemExit('The session email does not match the requested account')
session['user']=user
file=root/'.desktop-bootstrap-session.json'
file.write_text(json.dumps(session));file.chmod(0o600)
print(json.dumps({'success':True,'email':user['email'],'flow':'local_admin_magiclink_verified','smtp_sent':False,'session_file':str(file),'expires_in':session['expires_in']}))