from pathlib import Path
import hashlib
import io
import json
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from launcher_updater import LauncherUpdater, validate_manifest


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / 'POE2-Launcher'; self.base.mkdir()
        self.updater = LauncherUpdater(self.base, 'test-request')
        self.updater.app.mkdir()
        (self.updater.app / 'POE2 Unofficial Launcher.exe').write_bytes(b'old')
        (self.updater.app / '.launcher-build.json').write_text(json.dumps({'build':1,'version':'old'}))
        self.game = self.base / 'compatdata/game.dat'; self.game.parent.mkdir(); self.game.write_bytes(b'game')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:
            z.writestr('POE2 Unofficial Launcher.exe', b'new')
            z.writestr('resources/app.asar', b'app')
        self.data = buffer.getvalue()
        self.manifest = {'schema':1,'build':2,'version':'new','url':'https://github.com/sunim87/decky-poe-launcher/releases/download/v0.1.1/runtime.zip','size':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}
        self.updater.opener = lambda *args, **kwargs: io.BytesIO(self.data)
        self.guard = patch('launcher_updater.ensure_stopped'); self.guard.start(); self.addCleanup(self.guard.stop)

    def test_download_verify_apply_only_replaces_launcher(self):
        self.assertTrue(self.updater.download(self.manifest))
        self.assertEqual((self.updater.app / 'POE2 Unofficial Launcher.exe').read_bytes(), b'old')
        self.assertTrue(self.updater.apply())
        self.assertEqual((self.updater.app / 'POE2 Unofficial Launcher.exe').read_bytes(), b'new')
        self.assertEqual(self.game.read_bytes(),b'game')
        self.assertEqual(self.updater.current(),2)
        self.assertEqual((self.updater.backup / 'POE2 Unofficial Launcher.exe').read_bytes(),b'old')

    def test_bad_checksum_preserves_old_launcher(self):
        self.manifest['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'checksum'): self.updater.download(self.manifest)
        self.assertEqual((self.updater.app/'POE2 Unofficial Launcher.exe').read_bytes(),b'old')
        self.assertFalse(self.updater.pending.exists())

    def test_tampered_stage_cannot_apply(self):
        self.updater.download(self.manifest)
        self.updater.archive.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'checksum'):self.updater.apply()
        self.assertEqual(self.updater.current(),1)

    def test_unsafe_archive_cannot_touch_game(self):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:z.writestr('../compatdata/game.dat',b'destroy')
        data=buffer.getvalue();self.updater.opener=lambda *a,**k:io.BytesIO(data)
        self.manifest.update(size=len(data),sha256=hashlib.sha256(data).hexdigest())
        self.updater.download(self.manifest)
        with self.assertRaisesRegex(ValueError,'Unsafe'):self.updater.apply()
        self.assertEqual(self.game.read_bytes(),b'game')

    def test_running_game_blocks_apply_but_keeps_download(self):
        self.updater.download(self.manifest)
        with patch('launcher_updater.ensure_stopped',side_effect=RuntimeError('Close game')):
            with self.assertRaisesRegex(RuntimeError,'Close game'):self.updater.apply()
        self.assertTrue(self.updater.pending.exists());self.assertEqual(self.updater.current(),1)

    def test_recovers_interrupted_folder_swap(self):
        self.updater.download(self.manifest)
        self.updater.app.replace(self.updater.backup)
        self.assertFalse(self.updater.app.exists())
        self.updater.recover()
        self.assertEqual(self.updater.current(),1)
        self.assertTrue(self.updater.apply())

    def test_never_installs_older_build(self):
        self.manifest['build']=1
        self.assertFalse(self.updater.download(self.manifest))
        self.assertFalse(self.updater.pending.exists())

    def test_migrates_legacy_wrapper_once(self):
        bridge = self.updater.app / 'resources/gamepad_bridge.py'
        bridge.parent.mkdir()
        bridge.touch()
        wrapper = self.base / 'launch-poe2.sh'
        wrapper.write_text(
            '#!/bin/bash\nexport POE_LAUNCHER_BASE="$base"\n'
            'python3 "$base/launcher_updater.py" --base "$base" --check-and-apply\n'
            'while true; do\n  break\ndone\n'
        )
        wrapper.chmod(0o755)
        self.updater.migrate_wrapper()
        updated = wrapper.read_text()
        self.assertIn('--apply-only', updated)
        self.assertNotIn('--check-and-apply', updated)
        self.assertLess(updated.index('export POE_GAMEPAD_STATE'), updated.index('while true; do'))
        self.updater.migrate_wrapper()
        self.assertEqual(wrapper.read_text(), updated)

    def test_rejects_foreign_feed_downloads(self):
        self.manifest['url']='https://example.com/runtime.zip'
        with self.assertRaisesRegex(ValueError,'repository'):validate_manifest(self.manifest)


if __name__=='__main__':unittest.main()
