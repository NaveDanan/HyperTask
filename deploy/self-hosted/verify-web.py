#!/usr/bin/env python3
"""Check self-hosted web entry/assets without opening a browser."""
import html.parser,json,pathlib,urllib.parse,urllib.request
root=pathlib.Path(__file__).resolve().parent
values=dict(l.split('=',1) for l in (root/'.env').read_text().splitlines() if '=' in l)
origin=values['SERVER_ORIGIN'].rstrip('/')
class Assets(html.parser.HTMLParser):
    def __init__(self): super().__init__();self.assets=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='script' and attrs.get('src'): self.assets.append(attrs['src'])
        if tag=='link' and attrs.get('rel') in ('stylesheet','icon'): self.assets.append(attrs.get('href',''))
with urllib.request.urlopen(origin+'/app',timeout=20) as response:
    document=response.read().decode();csp=response.headers.get('Content-Security-Policy','');status=response.status
parser=Assets();parser.feed(document)
external=[url for url in parser.assets if urllib.parse.urlparse(url).netloc]
if external: raise RuntimeError('Web page has external runtime assets')
if 'https://appflowy.com' in document or 'fonts.googleapis.com' in document: raise RuntimeError('Web HTML retained a hosted origin')
if not csp: raise RuntimeError('Web proxy did not serve the runtime isolation policy')
loaded=[]
for url in parser.assets:
    with urllib.request.urlopen(urllib.parse.urljoin(origin+'/',url),timeout=20) as response:
        loaded.append({'path':url,'status':response.status,'bytes':len(response.read())})
print(json.dumps({'entry_status':status,'external_runtime_assets':external,'csp_present':True,'assets':loaded}))