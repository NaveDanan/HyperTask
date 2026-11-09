#!/usr/bin/env python3
"""Authenticated realtime handshake using a private local bootstrap session."""
import base64,hashlib,json,os,pathlib,socket,ssl,time,urllib.parse,uuid
root=pathlib.Path(__file__).resolve().parent
values=dict(l.split('=',1) for l in (root/'.env').read_text().splitlines() if '=' in l)
u=urllib.parse.urlparse(values['SERVER_ORIGIN'])
session=json.loads((root/'.desktop-bootstrap-session.json').read_text())
key=base64.b64encode(os.urandom(16)).decode()
headers={'Host':u.netloc,'Upgrade':'websocket','Connection':'Upgrade','Sec-WebSocket-Key':key,'Sec-WebSocket-Version':'13','Authorization':session['access_token'],'client-version':'0.11.4','device-id':'readiness-'+str(uuid.uuid4()),'connect-at':str(int(time.time()))}
request='GET /ws/v1 HTTP/1.1\r\n'+''.join(k+': '+v+'\r\n' for k,v in headers.items())+'\r\n'
connection=socket.create_connection((u.hostname,u.port or (443 if u.scheme=='https' else 80)),timeout=15)
if u.scheme=='https': connection=ssl.create_default_context().wrap_socket(connection,server_hostname=u.hostname)
try:
    connection.sendall(request.encode())
    response=b''
    while b'\r\n\r\n' not in response: response+=connection.recv(4096)
    status=response.split(b'\r\n',1)[0].decode()
    if ' 101 ' not in status:
        print(json.dumps({'websocket_upgrade':False,'status':status}));raise SystemExit(1)
    expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    if ('sec-websocket-accept: '+expected).lower().encode() not in response.lower():
        raise RuntimeError('Realtime handshake returned an invalid websocket accept key')
    # Client close frame, masked as required by RFC6455.
    mask=os.urandom(4);payload=bytes((3,232));masked=bytes(value^mask[index%4] for index,value in enumerate(payload))
    connection.sendall(bytes((0x88,0x82))+mask+masked)
    print(json.dumps({'websocket_upgrade':True,'status':status,'client_version':'0.11.4'}))
finally:
    connection.close()