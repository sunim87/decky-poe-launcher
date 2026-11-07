from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
launcher = Path(sys.argv[1]).resolve()
assert (launcher / 'POE2 Unofficial Launcher.exe').is_file()
payload = root / 'bin/launcher.zip'
if '--reuse-payload' not in sys.argv:
    with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for file in sorted(launcher.rglob('*')):
            if file.is_file(): z.write(file, file.relative_to(launcher).as_posix())
config = json.loads((root / 'release-config.json').read_text(encoding='utf8'))
release = {'version': config['launcherVersion'], 'build':config['build'], 'sha256': hashlib.sha256(payload.read_bytes()).hexdigest(),
           'features': ['LSFG-VK / MAKO mutually exclusive', 'FSR 4.1.2 INT8 Lite + OptiScaler 0.9.4', 'Reflex OFF', 'Watermark auto', 'repeat launch fix']}
(root / 'bin/release.json').write_text(json.dumps(release, indent=2), encoding='utf8')
version = json.loads((root / 'package.json').read_text(encoding='utf8'))['version']
feed = {'schema':1,'build':config['build'],'version':config['launcherVersion'],'url':f'https://github.com/sunim87/decky-poe-launcher/releases/download/v{version}/POE-Launcher-runtime-v{version}.zip','sha256':release['sha256'],'size':payload.stat().st_size}
(root / 'bin/launcher-update.json').write_text(json.dumps(feed,indent=2),encoding='utf8')
output = root.parent / f'Decky-POE-Launcher-v{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for relative in ['main.py', 'manager.py', 'launcher_updater.py', 'package.json', 'plugin.json', 'README.md', 'LICENSE']:
        z.write(root / relative, 'decky-poe-launcher/' + relative)
    for directory in ['dist', 'assets', 'bin', 'licenses']:
        for file in sorted((root / directory).rglob('*')):
            if file.is_file(): z.write(file, 'decky-poe-launcher/' + file.relative_to(root).as_posix(), compress_type=zipfile.ZIP_STORED if file == payload else zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    assert 'decky-poe-launcher/bin/launcher.zip' in z.namelist()
print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'launcherBytes':payload.stat().st_size}))
