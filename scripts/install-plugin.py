from pathlib import Path
import zipfile,shutil,os,time,json,pwd
archive=Path('/home/deck/Decky-POE-Launcher-v0.1.0.zip')
plugins=Path('/home/deck/homebrew/plugins')
target=plugins/'decky-poe-launcher'
assert plugins.resolve()==Path('/home/deck/homebrew/plugins') and not target.is_symlink()
stage=plugins/('.poe-install-'+str(int(time.time())))
stage.mkdir()
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for i in z.infolist():
  p=(stage/i.filename).resolve()
  assert p.is_relative_to(stage.resolve()) and '\\' not in i.filename
 z.extractall(stage)
source=stage/'decky-poe-launcher'
assert json.loads((source/'plugin.json').read_text())['name']=='Decky POE Launcher'
assert (source/'dist/index.js').is_file()
if target.exists():
 backup=Path('/home/deck/decky-backups')/('poe-launcher-'+time.strftime('%Y%m%d-%H%M%S'))
 backup.parent.mkdir(parents=True,exist_ok=True)
 shutil.move(target,backup)
source.rename(target)
assert stage.resolve().parent==plugins.resolve()
stage.rmdir()
uid=pwd.getpwnam('deck').pw_uid;gid=pwd.getpwnam('deck').pw_gid
for p in [target,*target.rglob('*')]:
 os.chown(p,uid,gid)
 p.chmod(0o755 if p.is_dir() else 0o644)
print('Installed Decky POE Launcher 0.1.0')
