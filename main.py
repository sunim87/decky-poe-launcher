import asyncio
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from manager import Manager


class Plugin:
    async def _main(self):
        self.manager = Manager(ROOT, os.environ.get('DECKY_USER_HOME', '/home/deck'))
        self.lock = asyncio.Lock()

    async def _unload(self):
        pass

    async def _call(self, method, *args):
        try:
            async with self.lock:
                return await asyncio.to_thread(getattr(self.manager, method), *args)
        except Exception as error:
            return {'ok': False, 'error': str(error)}

    async def status(self, user): return await self._call('status', user)
    async def installation_dependencies(self, user): return await self._call('installation_dependencies', user)
    async def prepare_install(self, user): return await self._call('prepare_install', user)
    async def finish_install(self, user, appid): return await self._call('finish_install', user, appid)
    async def prepare_remove(self, user): return await self._call('prepare_remove', user)
    async def finish_remove(self, user, appid): return await self._call('finish_remove', user, appid)
    async def artwork(self, name): return await self._call('artwork', name)
