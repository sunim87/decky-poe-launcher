import { existsSync } from "fs";

import type { KakaoGameStarterMigrationRequest } from "../../../shared/types";

export type KakaoGameStarterId = "kakaogames" | "daum";

export type KakaoGameStarterDefinition = {
  id: KakaoGameStarterId;
  label: string;
  protocol: string;
  protocolCommandKeys: readonly string[];
  fallbackExePath: string;
  fallbackSubPath: string;
};

export type ResolvedKakaoGameStarter = {
  id: KakaoGameStarterId;
  label: string;
  exePath: string;
  source: string;
};

export type KakaoGameStarterUacStatus = ResolvedKakaoGameStarter & {
  runAsInvokerEnabled: boolean;
};

export type RegistryReader = (
  path: string,
  name?: string,
) => Promise<string | null>;

export type PathExists = (path: string) => boolean;

export const KAKAO_GAMES_STARTER_INSTALLER_URL =
  "https://common.gdn.gamecdn.net/live/KakaogamesStarterSetup.exe";

export const KAKAO_GAME_STARTERS = [
  {
    id: "kakaogames",
    label: "KakaogamesStarter",
    protocol: "KakaogamesStarter",
    protocolCommandKeys: [
      "HKCU:\\Software\\Classes\\KakaogamesStarter\\shell\\open\\command",
      "HKLM:\\Software\\Classes\\KakaogamesStarter\\shell\\open\\command",
      "Registry::HKEY_CLASSES_ROOT\\KakaogamesStarter\\shell\\open\\command",
    ],
    fallbackExePath:
      "C:\\Users\\Default\\AppData\\Roaming\\KakaoGames\\KakaogamesStarter.exe",
    fallbackSubPath: "KakaoGames\\KakaogamesStarter.exe",
  },
  {
    id: "daum",
    label: "DaumGameStarter",
    protocol: "daumgamestarter",
    protocolCommandKeys: [
      "HKCU:\\Software\\Classes\\daumgamestarter\\shell\\open\\command",
      "HKLM:\\Software\\Classes\\DaumGameStarter\\shell\\open\\command",
      "Registry::HKEY_CLASSES_ROOT\\daumgamestarter\\shell\\open\\command",
    ],
    fallbackExePath:
      "C:\\Users\\Default\\AppData\\Roaming\\DaumGames\\DaumGameStarter.exe",
    fallbackSubPath: "DaumGames\\DaumGameStarter.exe",
  },
] as const satisfies readonly KakaoGameStarterDefinition[];

export function extractStarterExePath(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(/^"([^"]+?\.exe)"/i);
  if (quoted?.[1]) return quoted[1];

  const unquoted = trimmed.match(/^(.+?\.exe)(?:\s|$)/i);
  return unquoted?.[1]?.trim() || null;
}

export async function resolveInstalledKakaoGameStarters(
  readRegistryValue: RegistryReader,
  pathExists: PathExists = existsSync,
): Promise<ResolvedKakaoGameStarter[]> {
  const resolved: ResolvedKakaoGameStarter[] = [];
  const seenPaths = new Set<string>();

  for (const starter of KAKAO_GAME_STARTERS) {
    const candidate = await resolveStarterExecutable(
      starter,
      readRegistryValue,
      pathExists,
    );

    if (!candidate) continue;

    const dedupeKey = candidate.exePath.toLowerCase();
    if (seenPaths.has(dedupeKey)) continue;

    seenPaths.add(dedupeKey);
    resolved.push(candidate);
  }

  return resolved;
}

export function isAnyStarterRunAsInvokerEnabled(
  statuses: readonly KakaoGameStarterUacStatus[],
): boolean {
  return statuses.some((starter) => starter.runAsInvokerEnabled);
}

export function isStarterMissingRunAsInvoker(
  statuses: readonly KakaoGameStarterUacStatus[],
  id: KakaoGameStarterId,
): boolean {
  return statuses.some(
    (starter) => starter.id === id && !starter.runAsInvokerEnabled,
  );
}

export function getKakaoGameStarterMigrationRequest(
  starters: readonly ResolvedKakaoGameStarter[],
): KakaoGameStarterMigrationRequest | null {
  const kakaoStarter = starters.find((starter) => starter.id === "kakaogames");
  const daumStarter = starters.find((starter) => starter.id === "daum");

  if (!daumStarter) return null;

  if (kakaoStarter) {
    return {
      action: "remove-daum",
      installerUrl: KAKAO_GAMES_STARTER_INSTALLER_URL,
      daumExePath: daumStarter.exePath,
      kakaoExePath: kakaoStarter.exePath,
    };
  }

  return {
    action: "install-kakaogames",
    installerUrl: KAKAO_GAMES_STARTER_INSTALLER_URL,
    daumExePath: daumStarter.exePath,
  };
}

export type WindowsExecutableCommand = {
  filePath: string;
  arguments: string;
};

export function parseWindowsExecutableCommand(
  command: string,
): WindowsExecutableCommand | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted?.[1]) {
    return {
      filePath: quoted[1],
      arguments: quoted[2]?.trim() ?? "",
    };
  }

  const unquoted = trimmed.match(/^(\S+)(?:\s+(.*))?$/);
  if (!unquoted?.[1]) return null;

  return {
    filePath: unquoted[1],
    arguments: unquoted[2]?.trim() ?? "",
  };
}

async function resolveStarterExecutable(
  starter: KakaoGameStarterDefinition,
  readRegistryValue: RegistryReader,
  pathExists: PathExists,
): Promise<ResolvedKakaoGameStarter | null> {
  for (const key of starter.protocolCommandKeys) {
    const command = await readRegistryValue(key);
    const exePath = command ? extractStarterExePath(command) : null;

    if (exePath && isUsableStarterPath(exePath) && pathExists(exePath)) {
      return {
        id: starter.id,
        label: starter.label,
        exePath,
        source: key,
      };
    }
  }

  for (const fallbackExePath of getStarterFallbackExePaths(starter)) {
    if (!pathExists(fallbackExePath)) continue;

    return {
      id: starter.id,
      label: starter.label,
      exePath: fallbackExePath,
      source: "fallback",
    };
  }

  return null;
}

function getStarterFallbackExePaths(
  starter: KakaoGameStarterDefinition,
): string[] {
  const candidates = [
    joinWindowsPath(process.env.APPDATA, starter.fallbackSubPath),
    joinWindowsPath(process.env.LOCALAPPDATA, starter.fallbackSubPath),
    starter.fallbackExePath,
  ].filter((path): path is string => Boolean(path));

  return Array.from(new Set(candidates.map(normalizeWindowsPath)));
}

function isUsableStarterPath(exePath: string): boolean {
  const normalized = exePath.toLowerCase();
  return normalized.endsWith(".exe") && !normalized.includes("wscript.exe");
}

function joinWindowsPath(root: string | undefined, subPath: string): string {
  if (!root) return "";
  return `${root.replace(/[\\/]+$/, "")}\\${subPath}`;
}

function normalizeWindowsPath(targetPath: string): string {
  return targetPath.replace(/\//g, "\\");
}
