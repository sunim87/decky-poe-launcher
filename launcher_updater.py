"""Launcher-only updater. Never writes compatdata, Steam shortcuts, or Decky plugins."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile

FEED = 'https://github.com/sunim87/decky-poe-launcher/releases/latest/download/launcher-update.json'
DOWNLOAD_PREFIX = 'https://github.com/sunim87/decky-poe-launcher/releases/download/'
MAX_ARCHIVE = 1536 * 1024 * 1024
GAMEPAD_WRAPPER = """if [ -f "$base/launcher/resources/gamepad_bridge.py" ] && pad_dir=$(mktemp -d "$base/.gamepad-XXXXXX"); then
  export POE_GAMEPAD_STATE="$pad_dir/state.json"
  python3 "$base/launcher/resources/gamepad_bridge.py" "$POE_GAMEPAD_STATE" &
  pad_pid=$!
  trap 'kill "$pad_pid" 2>/dev/null || true; wait "$pad_pid" 2>/dev/null || true; rm -f -- "$POE_GAMEPAD_STATE" "$pad_dir/state.tmp"; rmdir -- "$pad_dir"' EXIT
fi
"""


def atomic_json(file, value):
    temporary = file.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf8')
    temporary.replace(file)


def validate_manifest(data):
    if not isinstance(data, dict) or data.get('schema') != 1:
        raise ValueError('Unsupported launcher update manifest')
    if type(data.get('build')) is not int or data['build'] < 1:
        raise ValueError('Invalid launcher build')
    if not isinstance(data.get('version'), str) or len(data['version']) > 80:
        raise ValueError('Invalid launcher version')
    if not re.fullmatch(r'[a-f0-9]{64}', data.get('sha256', '')):
        raise ValueError('Invalid launcher SHA256')
    if type(data.get('size')) is not int or not 0 < data['size'] <= MAX_ARCHIVE:
        raise ValueError('Invalid launcher archive size')
    if not isinstance(data.get('url'), str) or not data['url'].startswith(DOWNLOAD_PREFIX) or not data['url'].endswith('.zip'):
        raise ValueError('Update must come from the launcher repository')
    return data


def digest(file):
    # Steam Linux Runtime sniper ships Python 3.9; file_digest requires 3.11.
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): value.update(block)
    return value.hexdigest()


def ensure_stopped():
    for p in Path('/proc').iterdir():
        if not p.name.isdigit(): continue
        try: exe = (p / 'cmdline').read_bytes().split(b'\0')[0].decode(errors='replace').replace('\\','/').rsplit('/',1)[-1].lower()
        except OSError: continue
        if exe in ['poe2 unofficial launcher.exe','pathofexile_kg.exe','pathofexile_x64_kg.exe','pathofexile.exe','pathofexile_x64.exe','poe2_launcher.exe','poe_launcher.exe']:
            raise RuntimeError('Close the launcher and game before applying an update')


class LauncherUpdater:
    def __init__(self, base, request_id='', opener=urllib.request.urlopen):
        self.base = Path(base).absolute()
        if self.base.is_symlink() or self.base.resolve() != self.base:
            raise ValueError('Launcher directory must not be a symlink')
        self.base.mkdir(parents=True, exist_ok=True)
        self.app = self.base / 'launcher'
        self.pending = self.base / 'launcher-update-pending.json'
        self.archive = self.base / '.launcher-update.zip'
        self.backup = self.base / '.launcher-update-backup'
        self.request_id = request_id
        self.opener = opener

    def status(self, state, **extra):
        atomic_json(self.base / 'launcher-update-status.json', {'state':state, 'requestId':self.request_id, **extra})

    def current(self):
        marker = self.app / '.launcher-build.json'
        return json.loads(marker.read_text(encoding='utf8')).get('build', 0) if marker.exists() else 0

    def migrate_wrapper(self):
        wrapper = self.base / 'launch-poe2.sh'
        if wrapper.is_symlink() or not wrapper.is_file() or not (self.app / 'resources/gamepad_bridge.py').is_file():
            return
        script = wrapper.read_text(encoding='utf8')
        marker = 'while true; do\n'
        if (script.count(marker) != 1 or not script.startswith('#!/bin/bash\n')
                or 'export POE_LAUNCHER_BASE="$base"\n' not in script):
            return
        old_command = '"$base/launcher_updater.py" --base "$base" --check-and-apply'
        new_command = '"$base/launcher_updater.py" --base "$base" --apply-only'
        if old_command not in script and new_command not in script:
            return
        updated = script.replace(old_command, new_command, 1)
        if 'POE_GAMEPAD_STATE' not in script:
            updated = updated.replace(marker, GAMEPAD_WRAPPER + marker)
        if updated == script:
            return
        fd, name = tempfile.mkstemp(prefix='.launcher-wrapper-', dir=self.base)
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'w', encoding='utf8', newline='\n') as output:
                output.write(updated)
            temporary.chmod(wrapper.stat().st_mode & 0o777)
            temporary.replace(wrapper)
        finally:
            temporary.unlink(missing_ok=True)

    def recover(self):
        if not self.app.exists() and self.backup.is_dir() and not self.backup.is_symlink():
            self.backup.replace(self.app)

    def fetch_manifest(self):
        request = urllib.request.Request(FEED, headers={'User-Agent':'POE-Launcher-Updater'})
        with self.opener(request, timeout=12) as response:
            raw = response.read(65537)
            if len(raw) > 65536: raise ValueError('Update manifest too large')
            return validate_manifest(json.loads(raw))

    def download(self, manifest):
        manifest = validate_manifest(manifest)
        if manifest['build'] <= self.current():
            self.status('idle'); return False
        if self.archive.exists() and self.archive.stat().st_size == manifest['size'] and digest(self.archive) == manifest['sha256']:
            atomic_json(self.pending, manifest)
            self.status('downloaded', version=manifest['version']); return True
        temporary = self.base / '.launcher-update.download'
        self.status('downloading', version=manifest['version'], progress=0)
        request = urllib.request.Request(manifest['url'], headers={'User-Agent':'POE-Launcher-Updater'})
        received = 0; last = -1
        try:
            with self.opener(request, timeout=45) as response, temporary.open('wb') as stream:
                while True:
                    block = response.read(1024 * 1024)
                    if not block: break
                    received += len(block)
                    if received > manifest['size']: raise ValueError('Launcher download exceeds declared size')
                    stream.write(block)
                    percent = received * 100 // manifest['size']
                    if percent // 5 != last:
                        last = percent // 5
                        self.status('downloading', version=manifest['version'], progress=percent)
            if received != manifest['size'] or digest(temporary) != manifest['sha256']:
                raise ValueError('Launcher update checksum mismatch')
            temporary.replace(self.archive)
            atomic_json(self.pending, manifest)
            self.status('downloaded', version=manifest['version'])
            return True
        finally: temporary.unlink(missing_ok=True)

    def remove_owned_directory(self, directory):
        if directory.parent != self.base or directory.is_symlink() or directory.resolve().parent != self.base:
            raise ValueError('Unsafe update cleanup path')
        if directory.name not in ['launcher', '.launcher-update-backup'] and not directory.name.startswith('.launcher-update-stage-'):
            raise ValueError('Not an updater-owned directory')
        shutil.rmtree(directory)

    def apply(self):
        self.recover()
        if not self.pending.exists(): return False
        manifest = validate_manifest(json.loads(self.pending.read_text(encoding='utf8')))
        if manifest['build'] <= self.current():
            self.pending.unlink(); return False
        ensure_stopped()
        if not self.archive.exists() or self.archive.stat().st_size != manifest['size'] or digest(self.archive) != manifest['sha256']:
            raise ValueError('Staged launcher update checksum mismatch')
        if self.app.is_symlink() or self.backup.is_symlink(): raise ValueError('Unsafe launcher update path')
        stage = Path(tempfile.mkdtemp(prefix='.launcher-update-stage-', dir=self.base))
        try:
            with zipfile.ZipFile(self.archive) as z:
                if sum(i.file_size for i in z.infolist()) > 3 * 1024**3: raise ValueError('Extracted update is too large')
                for info in z.infolist():
                    target = (stage / info.filename).resolve()
                    if not target.is_relative_to(stage) or '\\' in info.filename or (info.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('Unsafe launcher archive path')
                z.extractall(stage)
            for required in ['POE2 Unofficial Launcher.exe', 'resources/app.asar']:
                if not (stage / required).is_file(): raise ValueError('Incomplete launcher update')
            atomic_json(stage / '.launcher-build.json', {'build':manifest['build'], 'version':manifest['version']})
            if self.backup.exists(): self.remove_owned_directory(self.backup)
            if self.app.exists(): self.app.replace(self.backup)
            try: stage.replace(self.app)
            except Exception:
                self.recover(); raise
            helper = self.app / 'resources/launcher_updater.py'
            if helper.is_file():
                temporary = self.base / 'launcher_updater.py.tmp'
                shutil.copy2(helper, temporary); temporary.replace(self.base / 'launcher_updater.py')
            self.pending.unlink(missing_ok=True)
            self.archive.unlink(missing_ok=True)
            self.status('installed', version=manifest['version'])
            return True
        finally:
            if stage.exists(): self.remove_owned_directory(stage)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--request-id', default='')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check-and-apply', action='store_true')
    modes.add_argument('--download-only', action='store_true')
    modes.add_argument('--apply-only', action='store_true')
    modes.add_argument('--migrate-wrapper', action='store_true')
    args = parser.parse_args()
    updater = LauncherUpdater(args.base, args.request_id)
    if args.migrate_wrapper:
        updater.migrate_wrapper()
        return 0
    import fcntl
    with (updater.base / '.launcher-update.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        try:
            updater.recover()
            if args.download_only:
                updater.download(updater.fetch_manifest())
            elif args.apply_only:
                updater.apply()
            else:
                # Apply already verified pending downloads even if the network is offline.
                try: updater.download(updater.fetch_manifest())
                except Exception as error: print('Launcher update check:', type(error).__name__)
                updater.apply()
            if not args.download_only:
                updater.migrate_wrapper()
        except Exception as error:
            updater.status('error', message=str(error)[:300]); print('Launcher updater:', str(error)[:300])
            return 1
    return 0


if __name__ == '__main__': raise SystemExit(main())
