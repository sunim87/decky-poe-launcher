"""User-owned launcher files. Steam library mutations use the frontend API."""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import shlex
import shutil
import struct
import tempfile
import zipfile

NAME = 'POE2 Launcher'
ASSETS = {'capsule': 0, 'hero': 1, 'logo': 2, 'wide': 3}
DEPENDENCIES = [(3658110, 'Proton 10.0', 'Proton 10.0/proton'),
                (1628350, 'Steam Linux Runtime 3.0 (sniper)', 'SteamLinuxRuntime_sniper/_v2-entry-point')]


def shortcuts(data):
    # Valve binary KeyValues. Read only: Steam remains the sole writer.
    pos = 0
    def string():
        nonlocal pos
        end = data.index(0, pos)
        value = data[pos:end].decode('utf8')
        pos = end + 1
        return value
    def obj():
        nonlocal pos
        result = {}
        while True:
            kind = data[pos]; pos += 1
            if kind == 8: return result
            key = string()
            if kind == 0: value = obj()
            elif kind == 1: value = string()
            elif kind in (2, 7):
                fmt, size = ('<I', 4) if kind == 2 else ('<Q', 8)
                value = struct.unpack_from(fmt, data, pos)[0]; pos += size
            else: raise ValueError('Steam 바로가기 형식을 읽지 못했습니다.')
            result[key] = value
    return list(obj().get('shortcuts', {}).values())


def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')
    temporary.replace(file)


class Manager:
    def __init__(self, root, home):
        self.root = Path(root).resolve()
        self.home = Path(home).resolve()
        self.base = self.home / 'Applications/POE2-Launcher'
        self.app = self.base / 'launcher'
        self.wrapper = self.base / 'launch-poe2.sh'
        self.state = self.home / '.local/share/decky-poe-launcher'
        self.steam = self.home / '.local/share/Steam'
        if not self.steam.is_dir() and (self.home / '.steam/steam').is_dir():
            self.steam = (self.home / '.steam/steam').resolve()

    def account(self, user):
        if not isinstance(user, str) or not re.fullmatch(r'[1-9][0-9]{0,9}', user) or int(user) > 0xffffffff:
            raise ValueError('Steam 사용자 정보를 확인하지 못했습니다.')
        result = self.steam / 'userdata' / user / 'config'
        if not result.is_dir(): raise ValueError('Steam 사용자 폴더가 없습니다.')
        return result

    def manifest(self, user):
        self.account(user)
        return self.state / (user + '.json')

    def record(self, user):
        file = self.manifest(user)
        return json.loads(file.read_text()) if file.exists() else {}

    def entries(self, user):
        file = self.account(user) / 'shortcuts.vdf'
        return shortcuts(file.read_bytes()) if file.exists() else []

    def matches(self, entry):
        exe = entry.get('Exe', '').strip('"')
        try: args = shlex.split(entry.get('LaunchOptions', ''))
        except ValueError: return False
        return exe in ['/bin/bash', '/usr/bin/bash', str(self.wrapper)] and (exe == str(self.wrapper) or args == [str(self.wrapper)])

    def ensure_stopped(self):
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit(): continue
            try: first = (proc / 'cmdline').read_bytes().split(b'\0')[0].decode(errors='replace')
            except OSError: continue
            name = first.replace('\\', '/').rsplit('/', 1)[-1].lower()
            if name in ['pathofexile_kg.exe', 'pathofexile_x64_kg.exe', 'poe2_launcher.exe', 'poe2 unofficial launcher.exe']:
                raise ValueError('게임과 POE 런처를 모두 종료한 뒤 다시 시도하세요.')

    def status(self, user):
        record = self.record(user)
        found = [entry for entry in self.entries(user) if self.matches(entry)]
        if len(found) > 1: raise ValueError('같은 런처 바로가기가 여러 개 있습니다. 중복을 먼저 정리하세요.')
        marker = self.app / '.launcher-build.json'
        version = json.loads(marker.read_text()).get('version') if marker.exists() else record.get('version')
        return {'ok': True, 'installed': (self.app / 'POE2 Unofficial Launcher.exe').is_file(),
                'registered': bool(found), 'appid': found[0]['appid'] if found else record.get('appid'),
                'managed': bool(record), 'version': version}

    def _wrapper(self, proton, runtime):
        q = shlex.quote
        return '\n'.join([
            '#!/bin/bash', 'set -e', 'base=' + q(str(self.base)),
            'export STEAM_COMPAT_CLIENT_INSTALL_PATH=' + q(str(self.steam)),
            'export STEAM_COMPAT_DATA_PATH="$base/compatdata"',
            'export POE_PROTON_PATH=' + q(str(proton)),
            'export POE_LAUNCHER_BASE="$base"',
            'mkdir -p -- "$STEAM_COMPAT_DATA_PATH"',
            'export ENABLE_GAMESCOPE_WSI=0', 'export DISABLE_LSFGVK=1',
            'export DISABLE_LSFGVK_EXPERIMENTAL=1', 'export DISABLE_MAKO=1',
            'unset ENABLE_MAKO LSFGVK_PROFILE MAKO_PROFILE',
            'python3 "$base/launcher_updater.py" --base "$base" --check-and-apply >> "$base/launcher-update.log" 2>&1 || true',
            'if [ -f "$base/launcher/resources/gamepad_bridge.py" ] && pad_dir=$(mktemp -d "$base/.gamepad-XXXXXX"); then',
            '  export POE_GAMEPAD_STATE="$pad_dir/state.json"',
            '  python3 "$base/launcher/resources/gamepad_bridge.py" "$POE_GAMEPAD_STATE" &',
            '  pad_pid=$!',
            '  trap \'kill "$pad_pid" 2>/dev/null || true; wait "$pad_pid" 2>/dev/null || true; rm -f -- "$POE_GAMEPAD_STATE" "$pad_dir/state.tmp"; rmdir -- "$pad_dir"\' EXIT',
            'fi',
            'while true; do',
            '  launcher_status=0',
            '  ' + q(str(runtime)) + ' --verb=run -- "$POE_PROTON_PATH" run ' +
            q(str(self.app / 'POE2 Unofficial Launcher.exe')) + ' "$@" >> "$base/launcher.log" 2>&1 || launcher_status=$?',
            '  if [ ! -f "$base/launcher-update-restart.flag" ]; then exit "$launcher_status"; fi',
            '  rm -- "$base/launcher-update-restart.flag"',
            '  python3 "$base/launcher_updater.py" --base "$base" --apply-only >> "$base/launcher-update.log" 2>&1 || true',
            'done', '',
        ])

    def dependency_paths(self):
        libraries = [self.steam]
        folders = self.steam / 'steamapps/libraryfolders.vdf'
        if folders.is_file():
            for value in re.findall(r'"path"\s*"((?:\\.|[^"\\])*)"', folders.read_text(encoding='utf8')):
                library = Path(value.replace('\\\\', '\\').replace('\\"', '"'))
                if library.is_absolute() and library not in libraries: libraries.append(library)
        result = {}
        for appid, _, relative in DEPENDENCIES:
            for library in libraries:
                executable = library / 'steamapps/common' / relative
                manifest = library / 'steamapps' / f'appmanifest_{appid}.acf'
                if not executable.is_file(): continue
                # Files may appear before Steam finishes extracting the tool.
                if manifest.is_file():
                    flags = re.search(r'"StateFlags"\s*"(\d+)"', manifest.read_text(encoding='utf8'))
                    if not flags or int(flags[1]) != 4: continue
                result[appid] = executable
                break
        return result

    def installation_dependencies(self, user):
        self.account(user)
        self.ensure_stopped()
        paths = self.dependency_paths()
        return {'ok': True, 'library': str(self.steam), 'dependencies': [
            {'appid': appid, 'name': name, 'installed': appid in paths} for appid, name, _ in DEPENDENCIES]}

    def prepare_install(self, user):
        self.account(user)
        self.ensure_stopped()
        record = self.record(user)
        existing = [e for e in self.entries(user) if self.matches(e)]
        if len(existing) > 1: raise ValueError('동일한 런처 바로가기가 여러 개 있습니다.')
        if any(e.get('AppName') == NAME and not self.matches(e) for e in self.entries(user)):
            raise ValueError('같은 이름의 다른 바로가기가 있습니다. 이름을 변경하세요.')
        paths = self.dependency_paths()
        if any(appid not in paths for appid, _, _ in DEPENDENCIES):
            raise ValueError('필수 Steam 도구 설치가 아직 끝나지 않았습니다. Steam 다운로드 상태를 확인하고 설치를 다시 눌러주세요.')
        proton, runtime = paths[3658110], paths[1628350]
        archive = self.root / 'bin/launcher.zip'
        release = json.loads((self.root / 'bin/release.json').read_text())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != release['sha256']:
            raise ValueError('런처 설치 파일 무결성 확인에 실패했습니다.')
        self.base.mkdir(parents=True, exist_ok=True)
        # Proton creates pfx.lock before creating its Windows prefix.
        (self.base / 'compatdata').mkdir(exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        if not record:
            # Adoption is explicit through Install. Keep the first wrapper backup.
            backup = self.state / ('before-' + user)
            backup.mkdir(exist_ok=True)
            if self.wrapper.exists(): shutil.copy2(self.wrapper, backup / 'launch-poe2.sh')
            legacy = self.base / 'compatdata/pfx/drive_c/users/steamuser/AppData/Local/Programs/poe2-unofficial-launcher'
            record = {'appid': existing[0]['appid'] if existing else None,
                      'legacy': legacy.is_dir(), 'phase': 'installing'}
            atomic_json(self.manifest(user), record)
        elif existing:
            record['appid'] = existing[0]['appid']
            atomic_json(self.manifest(user), record)
        marker = self.app / '.launcher-build.json'
        current = json.loads(marker.read_text()) if marker.exists() else {}
        if current.get('build', 0) > release.get('build', 0):
            # An older Decky plugin must never downgrade an automatically updated launcher.
            record.update(version=current['version'], phase='registering')
            atomic_json(self.manifest(user), record)
            (self.base / 'artwork').mkdir(exist_ok=True)
            for name in [*ASSETS, 'icon']:
                shutil.copy2(self.root / 'assets' / (name + '.png'), self.base / 'artwork' / (name + '.png'))
            return self.install_reply(record)
        staging = Path(tempfile.mkdtemp(prefix='.launcher-stage-', dir=self.base))
        previous = self.base / '.launcher-previous'
        try:
            with zipfile.ZipFile(archive) as z:
                for info in z.infolist():
                    dest = (staging / info.filename).resolve()
                    if not dest.is_relative_to(staging.resolve()) or '\\' in info.filename or (info.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('잘못된 설치 압축 경로입니다.')
                z.extractall(staging)
            if not (staging / 'POE2 Unofficial Launcher.exe').is_file(): raise ValueError('런처 실행 파일이 없습니다.')
            if self.app.exists():
                if previous.exists(): self._remove_directory(previous)
                self.app.replace(previous)
            staging.replace(self.app)
            atomic_json(self.app / '.launcher-build.json', {'version':release['version'], 'build':release.get('build', 0)})
            shutil.copy2(self.root / 'launcher_updater.py', self.base / 'launcher_updater.py')
            (self.base / 'artwork').mkdir(exist_ok=True)
            for name in [*ASSETS, 'icon']:
                shutil.copy2(self.root / 'assets' / (name + '.png'), self.base / 'artwork' / (name + '.png'))
            self.wrapper.write_text(self._wrapper(proton, runtime), encoding='utf8')
            self.wrapper.chmod(0o755)
            record.update(version=release['version'], phase='registering')
            atomic_json(self.manifest(user), record)
        except Exception:
            if previous.exists():
                if self.app.exists(): self._remove_directory(self.app)
                previous.replace(self.app)
            raise
        finally:
            if staging.exists(): self._remove_directory(staging)
        return self.install_reply(record)

    def install_reply(self, record):
        return {'ok': True, 'name': NAME, 'existing': record.get('appid'),
                'exe': '/bin/bash', 'options': shlex.quote(str(self.wrapper)),
                'home': '"' + str(self.base) + '"', 'icon': str(self.base / 'artwork/icon.png')}

    def finish_install(self, user, appid):
        if type(appid) is not int or not 0x80000000 <= appid <= 0xffffffff: raise ValueError('잘못된 바로가기 ID입니다.')
        record = self.record(user)
        if not record: raise ValueError('설치 준비 기록이 없습니다.')
        record.update(appid=appid, phase='installed')
        atomic_json(self.manifest(user), record)
        previous = self.base / '.launcher-previous'
        if previous.exists(): self._remove_directory(previous)
        return {'ok': True}

    def prepare_remove(self, user):
        self.ensure_stopped()
        record = self.record(user)
        if not record: raise ValueError('관리 기록이 없습니다. 설치/복구로 등록한 뒤 제거하세요.')
        entries = [e for e in self.entries(user) if e.get('appid') == record.get('appid')]
        if entries and not self.matches(entries[0]): raise ValueError('바로가기가 변경되어 자동 제거를 중단했습니다.')
        return {'ok': True, 'appid': record.get('appid')}

    def finish_remove(self, user, appid):
        self.ensure_stopped()
        record = self.record(user)
        if record.get('appid') != appid: raise ValueError('설치 기록과 제거 대상이 다릅니다.')
        if any(e.get('appid') == appid for e in self.entries(user)):
            raise ValueError('Steam 라이브러리 저장을 기다린 후 제거를 다시 눌러 주세요.')
        # Shared game/prefix and backups deliberately stay outside deletion targets.
        others = [p for p in self.state.glob('*.json') if p != self.manifest(user)]
        if not others:
            if self.app.exists(): self._remove_directory(self.app)
            if record.get('legacy'):
                legacy = self.base / 'compatdata/pfx/drive_c/users/steamuser/AppData/Local/Programs/poe2-unofficial-launcher'
                if legacy.exists(): self._remove_directory(legacy)
            self.wrapper.unlink(missing_ok=True)
            for name in ['launcher_updater.py', 'launcher-update-restart.flag', 'launcher-update-pending.json', 'launcher-update-status.json', '.launcher-update.zip', '.launcher-update.download', '.launcher-update.lock']:
                (self.base / name).unlink(missing_ok=True)
            old = self.base / '.launcher-update-backup'
            if old.exists(): self._remove_directory(old)
            artwork = self.base / 'artwork'
            if artwork.exists(): self._remove_directory(artwork)
        grid = self.account(user) / 'grid'
        for suffix in ['.png', '.jpg', 'p.png', 'p.jpg', '_hero.png', '_hero.jpg', '_logo.png', '_logo.jpg', '_icon.png', '_icon.jpg', '.json', '_logo.json']:
            (grid / (str(appid) + suffix)).unlink(missing_ok=True)
        self.manifest(user).unlink()
        return {'ok': True}

    def _remove_directory(self, directory):
        # Never accept a frontend-supplied deletion path or the shared prefix root.
        allowed = [self.app, self.base / '.launcher-previous', self.base / '.launcher-update-backup', self.base / 'artwork',
                   self.base / 'compatdata/pfx/drive_c/users/steamuser/AppData/Local/Programs/poe2-unofficial-launcher']
        resolved = directory.resolve()
        safe = any(resolved == p.absolute() for p in allowed) or (directory.name.startswith('.launcher-stage-') and directory.parent == self.base)
        if not safe or directory.is_symlink(): raise ValueError('제거 경로 확인에 실패했습니다.')
        shutil.rmtree(directory)

    def artwork(self, name):
        if name not in ASSETS: raise ValueError('알 수 없는 이미지입니다.')
        return {'ok': True, 'type': ASSETS[name], 'data': base64.b64encode((self.root / 'assets' / (name + '.png')).read_bytes()).decode()}
