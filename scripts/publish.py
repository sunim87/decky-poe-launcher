"""Publish this project using the current Git credential helper; never print credentials."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = 'sunim87/decky-poe-launcher'
root = Path(__file__).resolve().parents[1]
credential = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True,
                            env={**os.environ, 'GCM_INTERACTIVE':'never'}, check=True)
fields = dict(line.split('=',1) for line in credential.stdout.splitlines() if '=' in line)
auth = 'Basic ' + base64.b64encode((fields['username'] + ':' + fields['password']).encode()).decode()

def request(path, data=None, method=None, binary=False):
    url = path if path.startswith('https://') else 'https://api.github.com' + path
    body = data if binary else json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
          headers={'Authorization':auth, 'User-Agent':'Decky-POE-Publisher', 'Accept':'application/vnd.github+json',
                   'Content-Type':'application/octet-stream' if binary else 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as response:
        content = response.read()
        return json.loads(content) if content else {}

assert request('/user')['login'] == 'sunim87', 'Unexpected GitHub account'
if sys.argv[1] == 'create':
    try: repo = request('/repos/' + REPO)
    except urllib.error.HTTPError as error:
        if error.code != 404: raise
        repo = request('/user/repos', {'name':'decky-poe-launcher','description':'Steam Deck용 POE 런처 설치·제거와 Steam 라이브러리 이미지 자동 등록 Decky 플러그인', 'private':False,'has_issues':True,'auto_init':False})
    print(json.dumps({'url':repo['html_url'],'size':repo['size'],'default_branch':repo['default_branch']}))
elif sys.argv[1] == 'release':
    sha = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    body = (root / 'RELEASE_NOTES.md').read_text(encoding='utf8')
    try: release = request('/repos/' + REPO + '/releases/tags/v0.1.0')
    except urllib.error.HTTPError as error:
        if error.code != 404: raise
        release = request('/repos/' + REPO + '/releases',{'tag_name':'v0.1.0','target_commitish':sha,'name':'Decky POE Launcher v0.1.0','body':body,'draft':False,'prerelease':False})
    asset = root.parent / 'Decky-POE-Launcher-v0.1.0.zip'
    if any(a['name'] == asset.name for a in release['assets']): raise RuntimeError('Asset already exists; inspect before replacement')
    url = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(asset.name)
    result = request(url, asset.read_bytes(), method='POST', binary=True)
    assert result['size'] == asset.stat().st_size
    print(json.dumps({'release':release['html_url'],'download':result['browser_download_url'],'bytes':result['size']}))
elif sys.argv[1] == 'verify':
    release = request('/repos/' + REPO + '/releases/tags/v0.1.0')
    print(json.dumps({'release':release['html_url'],'assets':[{'name':a['name'],'bytes':a['size'],'state':a['state'],'digest':a.get('digest')} for a in release['assets']]}))
elif sys.argv[1] == 'notes':
    release = request('/repos/' + REPO + '/releases/tags/v0.1.0')
    result = request('/repos/' + REPO + '/releases/' + str(release['id']), {'body':(root / 'RELEASE_NOTES.md').read_text(encoding='utf8')}, method='PATCH')
    print(result['html_url'])
