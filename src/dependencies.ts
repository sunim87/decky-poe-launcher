export type Dependencies = { ok: boolean; error?: string; library?: string; dependencies?: { appid: number; name: string; installed: boolean }[] };

// Use Steam's installer so tool ownership, downloads and updates remain managed by Steam.
export async function ensureDependencies(
  steam: any,
  read: () => Promise<Dependencies>,
  progress: (message: string) => void,
  wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
) {
  const check = async () => {
    const reply = await read();
    if (!reply.ok || !reply.dependencies || !reply.library) throw Error(reply.error || '필수 도구 설치 상태를 확인하지 못했습니다.');
    return reply;
  };
  let state = await check();
  const missing = state.dependencies!.filter(tool => !tool.installed);
  if (!missing.length) return;
  if (!steam.Installs?.OpenInstallWizard) throw Error('Steam 설치 API를 사용할 수 없습니다. Steam을 다시 시작하세요.');
  const active = await steam.Installs.GetInstallManagerInfo();
  if (active.eInstallState > 0 && active.eInstallState < 14) throw Error('다른 Steam 설치 창을 먼저 완료하거나 닫은 뒤 다시 시도하세요.');
  const folders = await steam.InstallFolder.GetInstallFolders();
  const folder = folders.find((f: any) => f.strFolderPath.replace(/\/$/, '') === state.library!.replace(/\/$/, '') && f.bIsMounted !== false);
  if (!folder) throw Error('Steam 기본 라이브러리 폴더를 확인하지 못했습니다. Steam 저장소 설정을 확인하세요.');
  const ids = missing.map(tool => tool.appid);
  progress(`필수 도구 자동 설치 준비 중…\n${missing.map(tool => tool.name).join('\n')}`);
  await steam.Installs.OpenInstallWizard(ids);
  const deadline = now() + 60 * 60 * 1000;
  let started = false;
  while (now() < deadline) {
    await wait(1000);
    state = await check();
    const remaining = state.dependencies!.filter(tool => !tool.installed);
    if (!remaining.length) return;
    const info = await steam.Installs.GetInstallManagerInfo();
    const apps = info.rgApps || info.rgAppIDs || [];
    if (info.eInstallState > 0 && info.eInstallState < 14 && apps.length &&
        (apps.length !== ids.length || !apps.every((app: any) => ids.includes(app.nAppID))))
      throw Error('Steam 설치 대상이 변경됐습니다. 설치 창을 닫고 다시 시도하세요.');
    if (info.eInstallState === 15) throw Error(`필수 도구 설치 실패: ${info.errorDetail || 'Steam 다운로드와 디스크 여유 공간을 확인하세요.'}`);
    if (!started && info.eInstallState === 16) throw Error('필수 도구 설치가 취소됐습니다. 런처 설치를 다시 눌러주세요.');
    if (!started && info.eInstallState === 7) {
      await steam.Installs.SetInstallFolder(folder.nFolderIndex);
      await steam.Installs.SetCreateShortcuts(false, false);
      await steam.Installs.ContinueInstall();
      started = true;
    }
    progress(info.eInstallState === 8
      ? 'Steam 도구의 이용약관 창을 확인해 주세요. 완료 후 런처 설치가 이어집니다.'
      : `필수 도구 다운로드·설치 대기 중…\n${remaining.map(tool => tool.name).join('\n')}\nSteam 다운로드가 일시 정지되어 있으면 재개해 주세요.`);
  }
  throw Error('필수 도구 설치 대기 시간이 초과됐습니다. Steam 다운로드 완료 후 런처 설치를 다시 눌러주세요.');
}
