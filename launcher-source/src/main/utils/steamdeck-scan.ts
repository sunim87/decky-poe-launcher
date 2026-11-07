import * as fs from "node:fs";
import * as fsp from "node:fs/promises";

import { logger } from "./logger";
import { isWineEnvironment } from "./wine";
import { AppConfig } from "../../shared/types";

type ServiceChannel = AppConfig["serviceChannel"];
type ActiveGame = AppConfig["activeGame"];

/**
 * [SteamDeck] 레지스트리 기반 게임 경로 자동 탐지의 리눅스(Wine/Proton) 대응.
 *
 * 스팀덱에서는 게임이 이 런처와 "다른" Proton 프리픽스에 설치되어 있을 수
 * 있다 (예: poe1-kakao-launcher 프리픽스 안의 POE1). Wine은 리눅스 루트를
 * Z:\로 매핑하므로, 모든 프리픽스의 compatdata\<appid>\pfx\drive_c 아래에서
 * 알려진 설치 폴더를 스캔해 레지스트리 없이도 경로를 찾아낸다.
 */

// drive_c 기준 알려진 설치 폴더 후보
const GAME_DIR_CANDIDATES = {
  "Kakao Games": {
    POE1: [
      "Daum Games\\Path of Exile",
      "Kakaogames\\Path of Exile",
      "Kakao Games\\Path of Exile",
    ],
    POE2: [
      "Daum Games\\Path of Exile2",
      "Daum Games\\Path of Exile 2",
      "Kakaogames\\Path of Exile2",
      "Kakao Games\\Path of Exile2",
    ],
  },
  GGG: {
    POE1: [
      "Grinding Gear Games\\Path of Exile",
      "Program Files (x86)\\Grinding Gear Games\\Path of Exile",
    ],
    POE2: [
      "Grinding Gear Games\\Path of Exile 2",
      "Program Files (x86)\\Grinding Gear Games\\Path of Exile 2",
    ],
  },
} as const satisfies Record<
  ServiceChannel,
  Record<ActiveGame, readonly string[]>
>;

// 폴더 유효성 검사용 실행 파일 후보 (POE1 카카오는 설치에 따라 x64 이름만 있는 경우가 있음)
const EXECUTABLE_CANDIDATES = {
  "Kakao Games": ["PathOfExile_KG.exe", "PathOfExile_x64_KG.exe"],
  GGG: ["PathOfExile.exe", "PathOfExile_x64.exe"],
} as const satisfies Record<ServiceChannel, readonly string[]>;

const scanCache = new Map<string, string>();

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
};

const isValidInstallDir = async (
  dir: string,
  serviceId: ServiceChannel,
): Promise<boolean> => {
  for (const exe of EXECUTABLE_CANDIDATES[serviceId]) {
    if (await pathExists(`${dir}\\${exe}`)) return true;
  }
  return false;
};

/** 스팀 라이브러리(내장 + SD카드 등)의 compatdata 루트들을 나열 */
const listCompatdataRoots = async (): Promise<string[]> => {
  const roots: string[] = [];

  const internal =
    "Z:\\home\\deck\\.local\\share\\Steam\\steamapps\\compatdata";
  if (await pathExists(internal)) roots.push(internal);

  // 데스크탑 리눅스 등 홈 디렉터리가 deck이 아닌 경우
  try {
    const homes = await fsp.readdir("Z:\\home");
    for (const home of homes) {
      if (home === "deck") continue;
      const candidate = `Z:\\home\\${home}\\.local\\share\\Steam\\steamapps\\compatdata`;
      if (await pathExists(candidate)) roots.push(candidate);
    }
  } catch {
    // Z:\home 접근 불가 시 무시
  }

  // SD카드 / 외장 라이브러리: /run/media/<name>[/<name>]/steamapps/compatdata
  try {
    const mediaRoot = "Z:\\run\\media";
    const entries = await fsp.readdir(mediaRoot);
    for (const entry of entries) {
      const direct = `${mediaRoot}\\${entry}\\steamapps\\compatdata`;
      if (await pathExists(direct)) {
        roots.push(direct);
        continue;
      }
      try {
        const nested = await fsp.readdir(`${mediaRoot}\\${entry}`);
        for (const inner of nested) {
          const candidate = `${mediaRoot}\\${entry}\\${inner}\\steamapps\\compatdata`;
          if (await pathExists(candidate)) roots.push(candidate);
        }
      } catch {
        // 마운트 안 된 항목 무시
      }
    }
  } catch {
    // /run/media 없음 (데스크탑 등)
  }

  return roots;
};

/** 프리픽스들을 최근 수정순으로 정렬해 (최근에 쓴 게임부터) 스캔 순서를 최적화 */
const listPrefixDriveCs = async (root: string): Promise<string[]> => {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const numbered: Array<{ path: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const driveC = `${root}\\${entry.name}\\pfx\\drive_c`;
    try {
      const stat = await fsp.stat(driveC);
      numbered.push({ path: driveC, mtime: stat.mtimeMs });
    } catch {
      // pfx 없는 항목 무시
    }
  }

  return numbered.sort((a, b) => b.mtime - a.mtime).map((e) => e.path);
};

/**
 * 알려진 설치 폴더를 현재 프리픽스(C:\)와 모든 스팀 프리픽스(Z:\...)에서
 * 찾아 Windows식 경로를 돌려준다. 못 찾으면 null.
 */
export const scanSteamDeckGameInstallPath = async (
  serviceId: ServiceChannel,
  gameId: ActiveGame,
): Promise<string | null> => {
  if (!isWineEnvironment()) return null;

  const cacheKey = `${serviceId}/${gameId}`;
  const cached = scanCache.get(cacheKey);
  if (cached !== undefined) {
    if (await isValidInstallDir(cached, serviceId)) return cached;
    scanCache.delete(cacheKey);
  }

  const dirCandidates = GAME_DIR_CANDIDATES[serviceId]?.[gameId] ?? [];

  // 1. 현재 프리픽스의 C:\ 부터 (이 런처로 게임을 설치한 경우)
  for (const dir of dirCandidates) {
    const candidate = `C:\\${dir}`;
    if (await isValidInstallDir(candidate, serviceId)) {
      logger.log(
        `[SteamDeckScan] Found ${cacheKey} in current prefix: ${candidate}`,
      );
      scanCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  // 2. 다른 프리픽스들 (최근 수정순)
  for (const root of await listCompatdataRoots()) {
    for (const driveC of await listPrefixDriveCs(root)) {
      for (const dir of dirCandidates) {
        const candidate = `${driveC}\\${dir}`;
        if (await isValidInstallDir(candidate, serviceId)) {
          logger.log(`[SteamDeckScan] Found ${cacheKey} at: ${candidate}`);
          scanCache.set(cacheKey, candidate);
          return candidate;
        }
      }
    }
  }

  logger.log(`[SteamDeckScan] ${cacheKey} not found in any Steam prefix`);
  // A game can be installed while the launcher is open. Never cache a miss.
  return null;
};

/** 테스트/재스캔용 캐시 초기화 */
export const clearSteamDeckScanCache = (): void => {
  scanCache.clear();
};
