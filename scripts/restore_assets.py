"""Restore verified external DLL assets from a published installer ZIP."""
from pathlib import Path
import hashlib
import io
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
expected = json.loads((root / 'bin/release.json').read_text(encoding='utf8'))['sha256']
with zipfile.ZipFile(sys.argv[1]) as outer:
    payload = outer.read('decky-poe-launcher/bin/launcher.zip')
assert hashlib.sha256(payload).hexdigest() == expected, 'Installer payload checksum mismatch'
with zipfile.ZipFile(io.BytesIO(payload)) as inner:
    prefix = 'resources/assets/'
    for name in inner.namelist():
        if not name.startswith(prefix) or name.endswith('/'): continue
        target = (root / 'launcher-source/src/main/assets' / name[len(prefix):]).resolve()
        assert target.is_relative_to((root / 'launcher-source/src/main/assets').resolve())
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(inner.read(name))
print('External launcher assets restored and payload checksum verified.')
