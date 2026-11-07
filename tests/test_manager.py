from pathlib import Path
import hashlib
import json
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from manager import Manager


def vdf(entries):
    def obj(items):
        out = bytearray()
        for key, value in items.items():
            if isinstance(value, dict): out += b'\0' + key.encode() + b'\0' + obj(value)
            elif isinstance(value, int): out += b'\2' + key.encode() + b'\0' + struct.pack('<I', value)
            else: out += b'\1' + key.encode() + b'\0' + value.encode() + b'\0'
        return out + b'\10'
    return obj({'shortcuts': {str(i): e for i, e in enumerate(entries)}})


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'plugin'
        self.home = Path(self.temp.name) / 'home'
        self.manager = Manager(self.root, self.home)
        for path in [self.root / 'bin', self.root / 'assets', self.manager.steam / 'userdata/123/config']:
            path.mkdir(parents=True)
        for name in ['Proton 10.0/proton', 'SteamLinuxRuntime_sniper/_v2-entry-point']:
            p = self.manager.steam / 'steamapps/common' / name
            p.parent.mkdir(parents=True); p.write_text('fixture')
        archive = self.root / 'bin/launcher.zip'
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('POE2 Unofficial Launcher.exe', 'fixture')
            z.writestr('resources/app.asar', 'fixture')
        (self.root / 'bin/release.json').write_text(json.dumps({'version': 'test', 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
        for name in ['capsule','hero','logo','wide','icon']:
            (self.root / 'assets' / (name+'.png')).write_bytes(b'fixture')
        (self.root / 'launcher_updater.py').write_text('fixture')
        self.patcher = patch.object(Manager, 'ensure_stopped')
        self.patcher.start(); self.addCleanup(self.patcher.stop)

    def entries(self, values):
        (self.manager.account('123') / 'shortcuts.vdf').write_bytes(vdf(values))

    def test_install_remove_preserves_game_and_prefix(self):
        game = self.manager.base / 'compatdata/pfx/drive_c/Kakaogames/Path of Exile2/Content.ggpk'
        game.parent.mkdir(parents=True); game.write_bytes(b'game-data')
        reply = self.manager.prepare_install('123')
        self.assertTrue(self.manager.app.is_dir())
        self.assertIn('Proton 10.0', self.manager.wrapper.read_text())
        self.manager.finish_install('123', 0x90000001)
        self.entries([{'appid': 0x90000001, 'Exe': '/bin/bash', 'LaunchOptions': reply['options']}])
        self.assertEqual(self.manager.prepare_remove('123')['appid'], 0x90000001)
        self.entries([])
        self.manager.finish_remove('123', 0x90000001)
        self.assertFalse(self.manager.app.exists())
        self.assertFalse(self.manager.wrapper.exists())
        self.assertEqual(game.read_bytes(), b'game-data')

    def test_adopts_existing_shortcut_and_removes_only_legacy_launcher(self):
        legacy = self.manager.base / 'compatdata/pfx/drive_c/users/steamuser/AppData/Local/Programs/poe2-unofficial-launcher'
        legacy.mkdir(parents=True); (legacy / 'POE2 Unofficial Launcher.exe').write_text('old')
        self.entries([{'appid':0x90000002,'Exe':'/bin/bash','LaunchOptions':'"'+str(self.manager.wrapper)+'"'}])
        self.assertEqual(self.manager.prepare_install('123')['existing'], 0x90000002)
        self.manager.finish_install('123', 0x90000002)
        self.entries([])
        self.manager.finish_remove('123', 0x90000002)
        self.assertFalse(legacy.exists())
        self.assertTrue((self.manager.base / 'compatdata').exists())

    def test_refuses_modified_shortcut_and_wrong_id(self):
        self.manager.prepare_install('123'); self.manager.finish_install('123', 0x90000003)
        self.entries([{'appid':0x90000003,'Exe':'/somewhere/else','LaunchOptions':''}])
        with self.assertRaisesRegex(ValueError, '변경'): self.manager.prepare_remove('123')
        with self.assertRaisesRegex(ValueError, '다릅니다'): self.manager.finish_remove('123', 0x90000004)
        self.assertTrue(self.manager.app.exists())

    def test_bad_payload_is_rejected_without_installing(self):
        (self.root / 'bin/launcher.zip').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, '무결성'): self.manager.prepare_install('123')
        self.assertFalse(self.manager.app.exists())

    def test_retry_and_repair_keep_a_single_owned_app(self):
        self.manager.prepare_install('123')
        self.manager.prepare_install('123')
        self.manager.finish_install('123', 0x90000005)
        self.assertFalse((self.manager.base / '.launcher-previous').exists())
        self.assertEqual(self.manager.record('123')['phase'], 'installed')

    def test_no_recursive_deletion_of_shared_prefix(self):
        prefix = self.manager.base / 'compatdata'
        prefix.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, '경로'): self.manager._remove_directory(prefix)
        self.assertTrue(prefix.exists())

    def test_old_plugin_cannot_downgrade_new_launcher(self):
        self.manager.prepare_install('123')
        marker = self.manager.app / '.launcher-build.json'
        marker.write_text(json.dumps({'build':99,'version':'newer-launcher'}))
        exe = self.manager.app / 'POE2 Unofficial Launcher.exe'
        exe.write_text('newer-binary')
        self.manager.prepare_install('123')
        self.assertEqual(exe.read_text(), 'newer-binary')
        self.assertEqual(self.manager.status('123')['version'], 'newer-launcher')

    def test_refuses_archive_escape(self):
        archive = self.root / 'bin/launcher.zip'
        with zipfile.ZipFile(archive, 'w') as z: z.writestr('../escape', 'bad')
        (self.root / 'bin/release.json').write_text(json.dumps({'version':'test','sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
        with self.assertRaisesRegex(ValueError, '압축'): self.manager.prepare_install('123')
        self.assertFalse((self.manager.base / 'escape').exists())


if __name__ == '__main__': unittest.main()
