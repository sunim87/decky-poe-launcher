import { callable, definePlugin, toaster } from '@decky/api';
import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from '@decky/ui';
import { useEffect, useRef, useState } from 'react';
import { FaDragon } from 'react-icons/fa';
import { Dependencies, ensureDependencies } from './dependencies';

declare const SteamClient: any;
declare const App: any;
declare const appStore: any;
type Reply = { ok: boolean; error?: string; installed?: boolean; registered?: boolean; version?: string; appid?: number; existing?: number; name?: string; exe?: string; options?: string; home?: string; icon?: string; type?: number; data?: string };
const status = callable<[user: string], Reply>('status');
const dependencies = callable<[user: string], Dependencies>('installation_dependencies');
const prepare = callable<[user: string], Reply>('prepare_install');
const finish = callable<[user: string, appid: number], Reply>('finish_install');
const removal = callable<[user: string], Reply>('prepare_remove');
const clean = callable<[user: string, appid: number], Reply>('finish_remove');
const artwork = callable<[name: string], Reply>('artwork');
const account = () => String(BigInt(App.m_CurrentUser.strSteamID) & BigInt(0xffffffff));
const checked = (reply: Reply) => { if (!reply.ok) throw Error(reply.error || '작업에 실패했습니다.'); return reply; };
const delay = (time: number) => new Promise(resolve => setTimeout(resolve, time));

async function waitLibrary(id: number, present: boolean) {
  for (let i = 0; i < 80; i++) {
    if (!!appStore.GetAppOverviewByAppID(id) === present) return;
    await delay(250);
  }
  throw Error('Steam 라이브러리 갱신을 확인하지 못했습니다. 다시 시도하세요.');
}
function assertStopped(id: number) {
  const overview = appStore.GetAppOverviewByAppID(id);
  if (overview?.BIsRunning?.() || overview?.bIsRunning) throw Error('게임과 런처를 모두 종료하세요.');
}

async function install(progress: (message: string) => void) {
  const user = account();
  progress('필수 Steam 도구 확인 중…');
  await ensureDependencies(SteamClient, () => dependencies(user), progress);
  progress('런처 설치 파일 확인·설치 중…');
  const reply = checked(await prepare(user));
  let id = reply.existing || 0;
  if (id && !appStore.GetAppOverviewByAppID(id)) id = 0;
  if (id) assertStopped(id);
  if (!id) id = (await SteamClient.Apps.AddShortcut(reply.name, reply.exe, reply.home, reply.options)) >>> 0;
  if (!id) throw Error('Steam 바로가기를 만들지 못했습니다. 설치/복구를 다시 눌러주세요.');
  await waitLibrary(id, true);
  // Persist ownership before optional artwork so a failed image can be repaired.
  checked(await finish(user, id));
  progress('라이브러리 바로가기·이미지 등록 중…');
  SteamClient.Apps.SetShortcutName(id, reply.name);
  SteamClient.Apps.SetShortcutExe(id, reply.exe);
  SteamClient.Apps.SetShortcutStartDir(id, reply.home);
  SteamClient.Apps.SetShortcutLaunchOptions(id, reply.options);
  SteamClient.Apps.SetShortcutIcon(id, reply.icon);
  for (const name of ['capsule', 'hero', 'logo', 'wide']) {
    const image = checked(await artwork(name));
    await SteamClient.Apps.ClearCustomArtworkForApp(id, image.type);
    await delay(300);
    await SteamClient.Apps.SetCustomArtworkForApp(id, image.data, 'png', image.type);
  }
  await SteamClient.Apps.SetCustomLogoPositionForApp(id, JSON.stringify({ pinnedPosition: 'BottomLeft', nWidthPct: 45, nHeightPct: 60 }));
}

async function uninstall(progress: (message: string) => void) {
  const user = account();
  const reply = checked(await removal(user));
  const id = reply.appid;
  if (id) {
    assertStopped(id);
    progress('라이브러리 바로가기·이미지 제거 중…');
    if (appStore.GetAppOverviewByAppID(id)) {
      for (const type of [0, 1, 2, 3]) await SteamClient.Apps.ClearCustomArtworkForApp(id, type);
      SteamClient.Apps.RemoveShortcut(id);
      await waitLibrary(id, false);
    }
  }
  progress('런처 파일 제거 중…');
  let last: Reply = { ok: false };
  for (let i = 0; i < 80; i++) {
    last = await clean(user, id || 0);
    if (last.ok) return;
    if (!last.error?.includes('라이브러리 저장')) break;
    await delay(250);
  }
  checked(last);
}

function Content() {
  const [current, setCurrent] = useState<Reply>();
  const [message, setMessage] = useState('설치 상태 확인 중…');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const refresh = async () => {
    try { setCurrent(checked(await status(account()))); setMessage(''); }
    catch (error) { setMessage(String(error)); }
  };
  useEffect(() => { void refresh(); }, []);
  const run = async (remove: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      if (remove) await uninstall(setMessage); else await install(setMessage);
      await refresh();
      const text = remove ? '런처·라이브러리 제거 완료. 게임 파일과 저장 데이터는 보존했습니다.' : '설치 완료. 라이브러리의 POE2 Launcher에서 실행하세요.';
      setMessage(text); toaster.toast({ title: 'POE Launcher', body: text });
    } catch (error) { setMessage(String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <PanelSection title="POE 스팀덱 런처">
    <PanelSectionRow><div style={{ fontSize: 13, marginBottom: 12 }}>카카오 POE1·POE2 · LSFG-VK / MAKO · FSR 4.1.2 Lite<br />{current?.installed ? `설치됨 · ${current.version || '기존 버전'}` : '미설치'}{current?.registered ? ' · 라이브러리 등록됨' : ''}</div></PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below" disabled={busy} onClick={() => void run(false)}>{busy ? '작업 중…' : current?.installed ? '런처 설치/복구' : '런처 설치'}</ButtonItem></PanelSectionRow>
    <PanelSectionRow><ButtonItem layout="below" disabled={busy || !current?.appid} onClick={() => void run(true)}>런처 및 라이브러리 제거</ButtonItem></PanelSectionRow>
    <PanelSectionRow><div style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 12 }}>{message || 'Proton 10.0과 Steam Linux Runtime 3.0(sniper)이 없으면 함께 설치합니다.\n설치·제거 전 게임과 런처를 종료하세요.\n제거 시 POE 게임과 저장 데이터는 보존합니다.'}</div></PanelSectionRow>
  </PanelSection>;
}

export default definePlugin(() => ({ name: 'Decky POE Launcher', titleView: <div className={staticClasses.Title}>POE Launcher</div>, content: <Content />, icon: <FaDragon />, onDismount() {} }));
