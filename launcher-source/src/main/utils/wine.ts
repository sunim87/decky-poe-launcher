import * as fs from "node:fs";

let cachedIsWine: boolean | null = null;

/**
 * Wine/Proton(스팀덱) 프리픽스 안에서 실행 중인지 감지한다.
 *
 * Wine 프리픽스에는 powershell.exe가 없거나(구버전) 동작하지 않는 stub만
 * 있어서(신버전), PowerShell 기반 기능은 이 값을 보고 즉시 폴백/스킵해야
 * 한다. 그대로 스폰을 시도하면 ENOENT 반복 또는 요청당 10~30초 타임아웃이
 * 발생한다.
 */
export const isWineEnvironment = (): boolean => {
  if (cachedIsWine === null) {
    cachedIsWine = detectWine();
  }
  return cachedIsWine;
};

const detectWine = (): boolean => {
  if (process.platform !== "win32") return false;

  // Wine/Proton은 리눅스 쪽 환경변수를 Windows 프로세스에 그대로 물려준다.
  // SteamDeck=1은 스팀덱 게임 모드에서 Steam이 주입한다.
  const env = process.env;
  if (
    env.WINEPREFIX ||
    env.WINELOADER ||
    env.WINEDLLPATH ||
    env.STEAM_COMPAT_DATA_PATH ||
    env.SteamDeck
  ) {
    return true;
  }

  // 환경변수가 필터링된 경우를 대비한 파일 시그널:
  // winebrowser.exe는 Wine 전용 바이너리, Z:\는 Wine이 리눅스 루트를
  // 매핑하는 기본 드라이브라 Z:\proc\version이 존재하면 Wine이다.
  try {
    const windir = env.windir || "C:\\windows";
    if (fs.existsSync(`${windir}\\system32\\winebrowser.exe`)) return true;
    if (fs.existsSync("Z:\\proc\\version")) return true;
  } catch {
    // 감지 자체가 실패하면 일반 Windows로 간주
  }

  return false;
};

/** 테스트에서 감지 결과를 다시 계산시키기 위한 캐시 초기화 */
export const __resetWineDetectionCache = (): void => {
  cachedIsWine = null;
};
