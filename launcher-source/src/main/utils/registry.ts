import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { PowerShellManager } from "./powershell";
import { CONFIG_KEYS, DEFAULT_CONFIG } from "../../shared/config";
import {
  ActiveGame,
  AppConfig,
  GameInstallPathConflictAction,
  GameInstallPathConflictResolution,
  GameInstallPathConflictResolveResult,
  GameInstallPathConflictResolutions,
  GameInstallPathClearResult,
  GameInstallPathClearSource,
  GameInstallPathConfigDiagnostic,
  GameInstallPathDiagnostics,
  GameInstallPaths,
  GameInstallPathRegistryDiagnostic,
  GameInstallPathSaveResult,
  GameInstallPathVerificationStatus,
  ServiceChannel,
} from "../../shared/types";
import { ContextProvider } from "../context-provider";
import { setConfigWithEvent } from "../utils/config-utils";
import { logger } from "../utils/logger";
import { scanSteamDeckGameInstallPath } from "../utils/steamdeck-scan";

type RegistryReadResult =
  | {
      ok: true;
      value: string | null;
      state: "found" | "key-missing" | "value-missing" | "value-empty";
    }
  | { ok: false; error: string };

export type GameInstallationStatus = "installed" | "uninstalled" | "unknown";
type InstallPathVerificationStatus = Exclude<
  GameInstallPathVerificationStatus,
  "not-checked"
>;

type ExecFileError = Error & {
  code?: number | string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

type InstallPathResolution = {
  path: string | null;
  source?: "config" | "registry";
  error?: string;
  verifyError?: string;
  diagnostics: string[];
};

type ConfiguredInstallPathResult =
  | { state: "found"; path: string }
  | { state: "empty" | "context-unavailable"; path: null };

const GAME_EXECUTABLE_NAMES = {
  "Kakao Games": "PathOfExile_KG.exe",
  GGG: "PathOfExile.exe",
} as const satisfies Record<ServiceChannel, string>;

const getGameExecutableName = (serviceId: AppConfig["serviceChannel"]) =>
  GAME_EXECUTABLE_NAMES[serviceId];

/**
 * Registry Mapping for Game Installation Paths
 */
export const GAME_INSTALL_REGISTRY_MAP = {
  "Kakao Games": {
    POE1: {
      path: "HKCU:\\Software\\DaumGames\\POE",
      key: "InstallPath",
    },
    POE2: {
      path: "HKCU:\\Software\\DaumGames\\POE2",
      key: "InstallPath",
    },
  },
  GGG: {
    POE1: {
      path: "HKCU:\\Software\\GrindingGearGames\\Path of Exile",
      key: "InstallLocation",
    },
    POE2: {
      path: "HKCU:\\Software\\GrindingGearGames\\Path of Exile 2",
      key: "InstallLocation",
    },
  },
} as const satisfies Record<
  ServiceChannel,
  Record<ActiveGame, { path: string; key: string }>
>;

export const DAUM_STARTER_PROTOCOL_KEY =
  "Registry::HKEY_CLASSES_ROOT\\daumgamestarter\\shell\\open\\command";

// @ts-expect-error - injected by vite
const APP_GUID = __APP_GUID__;

export const LAUNCHER_UNINSTALL_REG_KEY = `Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_GUID}`;
export const LAUNCHER_APP_REG_KEY = `Registry::HKEY_CURRENT_USER\\Software\\${APP_GUID}`;

/**
 * Standardize registry paths to PowerShell Registry:: provider format
 */
const standardizeRegPath = (path: string): string => {
  if (path.startsWith("HKCU:\\"))
    return path.replace("HKCU:\\", "Registry::HKEY_CURRENT_USER\\");
  if (path.startsWith("HKLM:\\"))
    return path.replace("HKLM:\\", "Registry::HKEY_LOCAL_MACHINE\\");
  if (path.startsWith("HKCR:\\"))
    return path.replace("HKCR:\\", "Registry::HKEY_CLASSES_ROOT\\");
  return path;
};

const toRegExePath = (regPath: string): string | null => {
  const finalPath = standardizeRegPath(regPath);
  const prefixMap: Array<[string, string]> = [
    ["Registry::HKEY_CURRENT_USER\\", "HKCU\\"],
    ["Registry::HKEY_LOCAL_MACHINE\\", "HKLM\\"],
    ["Registry::HKEY_CLASSES_ROOT\\", "HKCR\\"],
  ];

  for (const [powershellPrefix, regExePrefix] of prefixMap) {
    if (finalPath.startsWith(powershellPrefix)) {
      return finalPath.replace(powershellPrefix, regExePrefix);
    }
  }

  return null;
};

/**
 * Normalize installation path by removing trailing slashes and ensuring consistent separators
 */
const normalizePath = (rawPath: string): string => {
  if (!rawPath) return "";
  let normalized = path.normalize(rawPath.trim());
  while (normalized.endsWith("\\") || normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const createDefaultGameInstallPaths = (): GameInstallPaths => ({
  "Kakao Games": { ...DEFAULT_CONFIG.gameInstallPaths["Kakao Games"] },
  GGG: { ...DEFAULT_CONFIG.gameInstallPaths.GGG },
});

const createDefaultGameInstallPathConflictResolutions =
  (): GameInstallPathConflictResolutions => ({
    "Kakao Games": {
      ...DEFAULT_CONFIG.gameInstallPathConflictResolutions["Kakao Games"],
    },
    GGG: { ...DEFAULT_CONFIG.gameInstallPathConflictResolutions.GGG },
  });

const normalizeGameInstallPaths = (value: unknown): GameInstallPaths => {
  const normalized = createDefaultGameInstallPaths();

  if (!value || typeof value !== "object") return normalized;

  const rawPaths = value as Partial<
    Record<
      AppConfig["serviceChannel"],
      Partial<Record<AppConfig["activeGame"], unknown>>
    >
  >;

  for (const serviceId of Object.keys(normalized) as Array<
    AppConfig["serviceChannel"]
  >) {
    for (const gameId of Object.keys(normalized[serviceId]) as Array<
      AppConfig["activeGame"]
    >) {
      const rawPath = rawPaths[serviceId]?.[gameId];
      normalized[serviceId][gameId] =
        typeof rawPath === "string" ? normalizePath(rawPath) : "";
    }
  }

  return normalized;
};

const normalizeGameInstallPathConflictResolutions = (
  value: unknown,
): GameInstallPathConflictResolutions => {
  const normalized = createDefaultGameInstallPathConflictResolutions();

  if (!value || typeof value !== "object") return normalized;

  const rawResolutions = value as Partial<
    Record<
      AppConfig["serviceChannel"],
      Partial<Record<AppConfig["activeGame"], unknown>>
    >
  >;

  for (const serviceId of Object.keys(normalized) as Array<
    AppConfig["serviceChannel"]
  >) {
    for (const gameId of Object.keys(normalized[serviceId]) as Array<
      AppConfig["activeGame"]
    >) {
      const rawResolution = rawResolutions[serviceId]?.[gameId];
      if (!rawResolution || typeof rawResolution !== "object") {
        normalized[serviceId][gameId] = null;
        continue;
      }

      const resolution =
        rawResolution as Partial<GameInstallPathConflictResolution>;
      if (
        typeof resolution.configPath !== "string" ||
        typeof resolution.registryPath !== "string" ||
        typeof resolution.resolvedAt !== "number"
      ) {
        normalized[serviceId][gameId] = null;
        continue;
      }

      normalized[serviceId][gameId] = {
        configPath: normalizePath(resolution.configPath),
        registryPath: normalizePath(resolution.registryPath),
        resolvedAt: resolution.resolvedAt,
      };
    }
  }

  return normalized;
};

const getConfiguredGameInstallPath = (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): ConfiguredInstallPathResult => {
  const context = ContextProvider.get();
  if (!context) return { state: "context-unavailable", path: null };

  const config = context.getConfig() as AppConfig;
  const gameInstallPaths = normalizeGameInstallPaths(config.gameInstallPaths);
  const installPath = gameInstallPaths[serviceId]?.[gameId];

  return installPath
    ? { state: "found", path: installPath }
    : { state: "empty", path: null };
};

const persistDiscoveredGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  installPath: string,
): Promise<boolean> => {
  const context = ContextProvider.get();
  if (!context) return false;

  const config = context.getConfig() as AppConfig;
  const currentPaths = normalizeGameInstallPaths(config.gameInstallPaths);

  if (currentPaths[serviceId][gameId] === installPath) return true;

  const nextValue: GameInstallPaths = {
    ...currentPaths,
    [serviceId]: {
      ...currentPaths[serviceId],
      [gameId]: installPath,
    },
  };

  setConfigWithEvent(CONFIG_KEYS.GAME_INSTALL_PATHS, nextValue);
  return true;
};

const persistGameInstallPathConflictResolution = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  resolution: GameInstallPathConflictResolution | null,
): Promise<boolean> => {
  const context = ContextProvider.get();
  if (!context) return false;

  const config = context.getConfig() as AppConfig;
  const currentResolutions = normalizeGameInstallPathConflictResolutions(
    config.gameInstallPathConflictResolutions,
  );

  const nextValue: GameInstallPathConflictResolutions = {
    ...currentResolutions,
    [serviceId]: {
      ...currentResolutions[serviceId],
      [gameId]: resolution,
    },
  };

  setConfigWithEvent(
    CONFIG_KEYS.GAME_INSTALL_PATH_CONFLICT_RESOLUTIONS,
    nextValue,
  );
  return true;
};

const isGameInstallPathConflictAcknowledged = (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  configPath: string | null,
  registryPath: string | null,
) => {
  if (!configPath || !registryPath) return false;

  const context = ContextProvider.get();
  if (!context) return false;

  const config = context.getConfig() as AppConfig;
  const resolutions = normalizeGameInstallPathConflictResolutions(
    config.gameInstallPathConflictResolutions,
  );
  const resolution = resolutions[serviceId]?.[gameId];

  if (!resolution) return false;

  return (
    areSameInstallPath(resolution.configPath, configPath) &&
    areSameInstallPath(resolution.registryPath, registryPath)
  );
};

/**
 * Executes a PowerShell command, optionally with Admin privileges (RunAs).
 */
/**
 * Executes a PowerShell command, optionally with Admin privileges (RunAs).
 * Delegates to the Singleton PowerShellManager.
 */
export const runPowerShell = async (
  psCommand: string,
  useAdmin: boolean = false,
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return PowerShellManager.getInstance().execute(psCommand, useAdmin);
};

const toOutputString = (value: string | Buffer | undefined): string => {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value ?? "";
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const escapePowerShellSingleQuotedString = (value: string): string =>
  value.replace(/'/g, "''");

const isMissingPathError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
};

const parseRegQueryValue = (
  stdout: string,
  key: string,
): { found: boolean; value: string | null; state: "found" | "value-empty" } => {
  const lowerKey = key.toLowerCase();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trimStart().match(/^(.*?)\s+REG_\S+\s*(.*)$/i);
    if (!match) continue;

    if (match[1].trim().toLowerCase() === lowerKey) {
      const value = match[2].trim();
      return {
        found: true,
        value: value || null,
        state: value ? "found" : "value-empty",
      };
    }
  }

  return { found: false, value: null, state: "value-empty" };
};

const parsePowerShellRegistryOutput = (stdout: string): RegistryReadResult => {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const marker = lines[0];

  if (marker === "__REG_KEY_MISSING__") {
    return { ok: true, value: null, state: "key-missing" };
  }

  if (marker === "__REG_VALUE_MISSING__") {
    return { ok: true, value: null, state: "value-missing" };
  }

  if (marker === "__REG_VALUE_EMPTY__") {
    return { ok: true, value: null, state: "value-empty" };
  }

  if (marker === "__REG_VALUE_FOUND__") {
    const value = lines.slice(1).join("\n").trim();
    return {
      ok: true,
      value: value || null,
      state: value ? "found" : "value-empty",
    };
  }

  const value = stdout.trim();
  return {
    ok: true,
    value: value || null,
    state: value ? "found" : "value-missing",
  };
};

const queryRegistryWithRegExe = async (
  regPath: string,
  key: string,
): Promise<RegistryReadResult> => {
  const queryPath = toRegExePath(regPath);
  if (!queryPath) {
    return { ok: false, error: `Unsupported registry path: ${regPath}` };
  }

  return new Promise<RegistryReadResult>((resolve) => {
    execFile(
      "reg.exe",
      ["query", queryPath, "/v", key],
      { windowsHide: true, timeout: 5000 },
      (error, stdout, stderr) => {
        if (!error) {
          const parsed = parseRegQueryValue(toOutputString(stdout), key);
          resolve({
            ok: true,
            value: parsed.value,
            state: parsed.found ? parsed.state : "value-missing",
          });
          return;
        }

        const execError = error as ExecFileError;
        if (execError.code === 1 || execError.code === "1") {
          execFile(
            "reg.exe",
            ["query", queryPath],
            { windowsHide: true, timeout: 5000 },
            (pathError) => {
              if (!pathError) {
                resolve({ ok: true, value: null, state: "value-missing" });
                return;
              }

              const pathExecError = pathError as ExecFileError;
              if (pathExecError.code === 1 || pathExecError.code === "1") {
                resolve({ ok: true, value: null, state: "key-missing" });
                return;
              }

              resolve({
                ok: false,
                error: formatError(pathExecError),
              });
            },
          );
          return;
        }

        resolve({
          ok: false,
          error:
            toOutputString(execError.stderr) ||
            toOutputString(stderr) ||
            formatError(execError),
        });
      },
    );
  });
};

const readRegistryValueDetailed = async (
  regPath: string,
  key: string,
): Promise<RegistryReadResult> => {
  const finalPath = standardizeRegPath(regPath);
  const psCommand = `
      $path = "${finalPath}"
      $name = "${key}"
      if (-not (Test-Path -LiteralPath $path)) {
        Write-Output "__REG_KEY_MISSING__"
      } else {
        $item = Get-Item -LiteralPath $path -ErrorAction Stop
        if ($item.GetValueNames() -notcontains $name) {
          Write-Output "__REG_VALUE_MISSING__"
        } else {
          $value = $item.GetValue($name, $null)
          if ($null -eq $value) {
            Write-Output "__REG_VALUE_MISSING__"
          } elseif ([string]::IsNullOrWhiteSpace([string]$value)) {
            Write-Output "__REG_VALUE_EMPTY__"
          } else {
            Write-Output "__REG_VALUE_FOUND__"
            Write-Output $value
          }
        }
      }
    `.trim();

  try {
    const { stdout, stderr, code } = await runPowerShell(psCommand);

    if (code === 0) {
      return parsePowerShellRegistryOutput(stdout);
    }

    const fallback = await queryRegistryWithRegExe(regPath, key);
    if (fallback.ok) return fallback;

    return {
      ok: false,
      error: `PowerShell failed (${stderr || `exit code ${code}`}); reg.exe failed (${fallback.error})`,
    };
  } catch (error) {
    const fallback = await queryRegistryWithRegExe(regPath, key);
    if (fallback.ok) return fallback;

    return {
      ok: false,
      error: `PowerShell threw (${formatError(error)}); reg.exe failed (${fallback.error})`,
    };
  }
};

/**
 * Reads a single registry value
 */
export const readRegistryValue = async (
  regPath: string,
  key: string,
): Promise<string | null> => {
  const result = await readRegistryValueDetailed(regPath, key);
  return result.ok ? result.value : null;
};

const writeRegistryWithRegExe = async (
  regPath: string,
  key: string,
  value: string,
): Promise<boolean> => {
  const addPath = toRegExePath(regPath);
  if (!addPath) return false;

  return new Promise<boolean>((resolve) => {
    execFile(
      "reg.exe",
      ["add", addPath, "/v", key, "/t", "REG_SZ", "/d", value, "/f"],
      { windowsHide: true, timeout: 5000 },
      (error) => resolve(!error),
    );
  });
};

const deleteRegistryWithRegExe = async (
  regPath: string,
  key: string,
): Promise<boolean> => {
  const deletePath = toRegExePath(regPath);
  if (!deletePath) return false;

  // 값이 없으면 reg.exe delete가 오류를 내므로, 없는 경우를 성공으로 간주
  const current = await queryRegistryWithRegExe(regPath, key);
  if (
    current.ok &&
    current.state !== "found" &&
    current.state !== "value-empty"
  ) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    execFile(
      "reg.exe",
      ["delete", deletePath, "/v", key, "/f"],
      { windowsHide: true, timeout: 5000 },
      (error) => resolve(!error),
    );
  });
};

/**
 * Writes a single registry value
 */
export const writeRegistryValue = async (
  regPath: string,
  key: string,
  value: string,
  useAdmin: boolean = false,
): Promise<boolean> => {
  try {
    const finalPath = standardizeRegPath(regPath);
    const safePath = escapePowerShellSingleQuotedString(finalPath);
    const safeKey = escapePowerShellSingleQuotedString(key);
    const safeValue = escapePowerShellSingleQuotedString(value);

    const psCommand = `
      $path = '${safePath}'
      $name = '${safeKey}'
      $value = '${safeValue}'
      if (-not (Test-Path -Path $path)) {
        New-Item -Path $path -Force | Out-Null
      }
      New-ItemProperty -Path $path -Name $name -Value $value -PropertyType String -Force | Out-Null
    `.trim();

    const { code } = await runPowerShell(psCommand, useAdmin);
    if (code === 0) return true;

    // [SteamDeck] PowerShell이 없는 Wine 환경 폴백 (읽기 폴백과 대칭)
    return await writeRegistryWithRegExe(regPath, key, value);
  } catch (_e) {
    return writeRegistryWithRegExe(regPath, key, value).catch(() => false);
  }
};

export const deleteRegistryValue = async (
  regPath: string,
  key: string,
  useAdmin: boolean = false,
): Promise<boolean> => {
  try {
    const finalPath = standardizeRegPath(regPath);
    const safePath = escapePowerShellSingleQuotedString(finalPath);
    const safeKey = escapePowerShellSingleQuotedString(key);

    const psCommand = `
      $path = '${safePath}'
      $name = '${safeKey}'
      if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path -ErrorAction Stop
        if ($item.GetValueNames() -contains $name) {
          Remove-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop
        }
      }
    `.trim();

    const { code } = await runPowerShell(psCommand, useAdmin);
    if (code === 0) return true;

    // [SteamDeck] PowerShell이 없는 Wine 환경 폴백 (읽기 폴백과 대칭)
    return await deleteRegistryWithRegExe(regPath, key);
  } catch (_e) {
    return deleteRegistryWithRegExe(regPath, key).catch(() => false);
  }
};

const getGameExecutablePath = (
  serviceId: AppConfig["serviceChannel"],
  installPath: string,
) => path.join(installPath, getGameExecutableName(serviceId));

const verifyGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  installPath: string,
): Promise<{
  status: InstallPathVerificationStatus;
  executablePath: string;
  error?: string;
}> => {
  const executablePath = getGameExecutablePath(serviceId, installPath);

  try {
    const stats = await fs.stat(executablePath);

    return stats.isFile()
      ? { status: "valid", executablePath }
      : { status: "missing", executablePath };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "missing", executablePath };
    }

    return { status: "unknown", executablePath, error: formatError(error) };
  }
};

const readRegistryInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<RegistryReadResult> => {
  const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId]?.[gameId];
  if (!registryInfo) {
    return {
      ok: false,
      error: `Unsupported game context: ${serviceId}/${gameId}`,
    };
  }

  const registryResult = await readRegistryValueDetailed(
    registryInfo.path,
    registryInfo.key,
  );

  if (!registryResult.ok) return registryResult;

  return {
    ok: true,
    value: registryResult.value ? normalizePath(registryResult.value) : null,
    state: registryResult.state,
  };
};

const writeRegistryInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  installPath: string,
): Promise<boolean> => {
  const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId]?.[gameId];
  if (!registryInfo) return false;

  return writeRegistryValue(registryInfo.path, registryInfo.key, installPath);
};

const deleteRegistryInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<boolean> => {
  const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId]?.[gameId];
  if (!registryInfo) return false;

  return deleteRegistryValue(registryInfo.path, registryInfo.key);
};

const getRegistryInstallPathLabel = (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
) => {
  const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId]?.[gameId];

  return registryInfo
    ? `${registryInfo.path} / ${registryInfo.key}`
    : `${serviceId}/${gameId}`;
};

const formatDiagnostics = (diagnostics: string[]) => {
  return diagnostics.length > 0 ? diagnostics.join("; ") : "no details";
};

const formatPathCheckFailure = (
  serviceId: AppConfig["serviceChannel"],
  source: "config" | "registry",
  installPath: string,
  status: InstallPathVerificationStatus,
  error?: string,
) => {
  const executableName = getGameExecutableName(serviceId);
  const executablePath = getGameExecutablePath(serviceId, installPath);

  if (status === "missing") {
    return `${source}=path-invalid (${executableName} missing at ${executablePath})`;
  }

  return `${source}=path-check-blocked (${executablePath}: ${error || "unknown error"})`;
};

const logInstallPathResolutionFailure = (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  resolution: InstallPathResolution,
) => {
  const message = `[Registry] Install path unresolved for ${gameId} (${serviceId}): ${formatDiagnostics(resolution.diagnostics)}`;

  if (resolution.error || resolution.verifyError) {
    logger.warn(
      `${message}${resolution.error ? `; error=${resolution.error}` : ""}${resolution.verifyError ? `; verifyError=${resolution.verifyError}` : ""}`,
    );
    return;
  }

  logger.log(message);
};

const resolveGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<InstallPathResolution> => {
  const diagnostics: string[] = [];
  const configuredPath = getConfiguredGameInstallPath(serviceId, gameId);
  let configuredVerifyError: string | undefined;

  if (configuredPath.path !== null) {
    const configuredInstallPath = configuredPath.path;
    const configuredStatus = await verifyGameInstallPath(
      serviceId,
      configuredInstallPath,
    );

    if (configuredStatus.status === "valid") {
      return { path: configuredInstallPath, source: "config", diagnostics };
    }

    configuredVerifyError = configuredStatus.error;
    diagnostics.push(
      formatPathCheckFailure(
        serviceId,
        "config",
        configuredInstallPath,
        configuredStatus.status,
        configuredStatus.error,
      ),
    );
  } else if (configuredPath.state === "context-unavailable") {
    diagnostics.push("config=context-unavailable");
  } else {
    diagnostics.push("config=empty");
  }

  // [SteamDeck] 레지스트리 탐지가 실패했을 때, 모든 Proton 프리픽스를 스캔해
  // 알려진 설치 폴더를 찾는 리눅스식 폴백. 찾으면 config에 저장해 다음부터는
  // 스캔 없이 바로 쓴다.
  const trySteamDeckScan = async (): Promise<InstallPathResolution | null> => {
    const scannedPath = await scanSteamDeckGameInstallPath(serviceId, gameId);
    if (!scannedPath) return null;

    const scannedStatus = await verifyGameInstallPath(serviceId, scannedPath);
    if (scannedStatus.status !== "valid") {
      diagnostics.push(
        formatPathCheckFailure(
          serviceId,
          "registry",
          scannedPath,
          scannedStatus.status,
          scannedStatus.error,
        ),
      );
      return null;
    }

    diagnostics.push(`deck-scan=found (${scannedPath})`);
    await persistDiscoveredGameInstallPath(serviceId, gameId, scannedPath);
    return { path: scannedPath, source: "config", diagnostics };
  };

  const registryResult = await readRegistryInstallPath(serviceId, gameId);
  const registryLabel = getRegistryInstallPathLabel(serviceId, gameId);

  if (!registryResult.ok) {
    diagnostics.push(`registry=read-failed (${registryLabel})`);
    const deckResolution = await trySteamDeckScan();
    if (deckResolution) return deckResolution;
    return { path: null, error: registryResult.error, diagnostics };
  }

  if (!registryResult.value) {
    diagnostics.push(`registry=${registryResult.state} (${registryLabel})`);
    const deckResolution = await trySteamDeckScan();
    if (deckResolution) return deckResolution;
    return { path: null, verifyError: configuredVerifyError, diagnostics };
  }

  const registryStatus = await verifyGameInstallPath(
    serviceId,
    registryResult.value,
  );

  if (registryStatus.status === "valid") {
    if (configuredPath.state === "empty") {
      await persistDiscoveredGameInstallPath(
        serviceId,
        gameId,
        registryResult.value,
      );
    }

    return { path: registryResult.value, source: "registry", diagnostics };
  }

  diagnostics.push(
    formatPathCheckFailure(
      serviceId,
      "registry",
      registryResult.value,
      registryStatus.status,
      registryStatus.error,
    ),
  );

  const deckResolution = await trySteamDeckScan();
  if (deckResolution) return deckResolution;

  return {
    path: null,
    verifyError: registryStatus.error ?? configuredVerifyError,
    diagnostics,
  };
};

const areSameInstallPath = (left: string | null, right: string | null) => {
  if (!left || !right) return false;
  return (
    normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase()
  );
};

const getRecommendedInstallPathSource = (
  configDiagnostic: GameInstallPathConfigDiagnostic,
  registryDiagnostic: GameInstallPathRegistryDiagnostic,
): "config" | "registry" | null => {
  if (
    configDiagnostic.verification === "valid" &&
    registryDiagnostic.verification !== "valid"
  ) {
    return "config";
  }

  if (
    registryDiagnostic.verification === "valid" &&
    configDiagnostic.verification !== "valid"
  ) {
    return "registry";
  }

  return null;
};

/**
 * Reads and verifies both saved config and registry paths without updating config.
 */
export const getGameInstallPathDiagnostics = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<GameInstallPathDiagnostics> => {
  const configuredPath = getConfiguredGameInstallPath(serviceId, gameId);
  const configDiagnostic: GameInstallPathConfigDiagnostic = {
    source: "config",
    path: configuredPath.path,
    state: configuredPath.state,
    verification: "not-checked",
  };

  if (configuredPath.path) {
    const verification = await verifyGameInstallPath(
      serviceId,
      configuredPath.path,
    );
    configDiagnostic.verification = verification.status;
    configDiagnostic.executablePath = verification.executablePath;
    configDiagnostic.error = verification.error;
  }

  const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId][gameId];
  const registryResult = await readRegistryInstallPath(serviceId, gameId);
  const registryDiagnostic: GameInstallPathRegistryDiagnostic = {
    source: "registry",
    path: registryResult.ok ? registryResult.value : null,
    state: registryResult.ok ? registryResult.state : "read-failed",
    verification: "not-checked",
    error: registryResult.ok ? undefined : registryResult.error,
    registryPath: registryInfo.path,
    registryValueName: registryInfo.key,
  };

  if (registryResult.ok && registryResult.value) {
    const verification = await verifyGameInstallPath(
      serviceId,
      registryResult.value,
    );
    registryDiagnostic.verification = verification.status;
    registryDiagnostic.executablePath = verification.executablePath;
    registryDiagnostic.error = verification.error;
  }

  const hasPathConflict =
    Boolean(configDiagnostic.path && registryDiagnostic.path) &&
    !areSameInstallPath(configDiagnostic.path, registryDiagnostic.path);

  return {
    serviceId,
    gameId,
    executableName: getGameExecutableName(serviceId),
    config: configDiagnostic,
    registry: registryDiagnostic,
    hasPathConflict,
    isPathConflictAcknowledged:
      hasPathConflict &&
      isGameInstallPathConflictAcknowledged(
        serviceId,
        gameId,
        configDiagnostic.path,
        registryDiagnostic.path,
      ),
    recommendedSource: getRecommendedInstallPathSource(
      configDiagnostic,
      registryDiagnostic,
    ),
  };
};

export const setGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  installPath: string,
): Promise<GameInstallPathSaveResult> => {
  const normalizedInstallPath = normalizePath(installPath);

  if (!normalizedInstallPath) {
    return {
      ok: false,
      verification: "not-checked",
      error: "Install path is empty.",
    };
  }

  const verification = await verifyGameInstallPath(
    serviceId,
    normalizedInstallPath,
  );
  if (verification.status !== "valid") {
    return {
      ok: false,
      path: normalizedInstallPath,
      verification: verification.status,
      error:
        verification.error ||
        `${getGameExecutableName(serviceId)}를 선택한 폴더에서 찾을 수 없습니다.`,
      diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
    };
  }

  const persisted = await persistDiscoveredGameInstallPath(
    serviceId,
    gameId,
    normalizedInstallPath,
  );

  if (!persisted) {
    return {
      ok: false,
      path: normalizedInstallPath,
      verification: verification.status,
      error: "App context is not available.",
      diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
    };
  }

  return {
    ok: true,
    path: normalizedInstallPath,
    diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
  };
};

export const clearGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  source: GameInstallPathClearSource,
): Promise<GameInstallPathClearResult> => {
  if (source === "config") {
    const context = ContextProvider.get();
    if (!context) {
      return {
        ok: false,
        source,
        error: "App context is not available.",
        diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
      };
    }

    const config = context.getConfig() as AppConfig;
    const currentPaths = normalizeGameInstallPaths(config.gameInstallPaths);
    const nextValue: GameInstallPaths = {
      ...currentPaths,
      [serviceId]: {
        ...currentPaths[serviceId],
        [gameId]: "",
      },
    };

    setConfigWithEvent(CONFIG_KEYS.GAME_INSTALL_PATHS, nextValue);

    return {
      ok: true,
      source,
      diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
    };
  }

  const deleted = await deleteRegistryInstallPath(serviceId, gameId);
  if (!deleted) {
    return {
      ok: false,
      source,
      error: "Failed to delete registry install path.",
      diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
    };
  }

  return {
    ok: true,
    source,
    diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
  };
};

export const resolveGameInstallPathConflict = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  action: GameInstallPathConflictAction,
): Promise<GameInstallPathConflictResolveResult> => {
  const diagnostics = await getGameInstallPathDiagnostics(serviceId, gameId);
  const configPath = diagnostics.config.path;
  const registryPath = diagnostics.registry.path;

  if (!configPath) {
    return {
      ok: false,
      action,
      verification: "not-checked",
      error: "Launcher config path is empty.",
      diagnostics,
    };
  }

  const verification = await verifyGameInstallPath(serviceId, configPath);
  if (verification.status !== "valid") {
    return {
      ok: false,
      action,
      path: configPath,
      verification: verification.status,
      error:
        verification.error ||
        `런처 설정 경로에서 ${getGameExecutableName(serviceId)}를 찾을 수 없습니다.`,
      diagnostics,
    };
  }

  if (action === "launcher-config-only") {
    if (!registryPath) {
      return {
        ok: false,
        action,
        path: configPath,
        verification: verification.status,
        error: "Registry path is empty.",
        diagnostics,
      };
    }

    const persisted = await persistGameInstallPathConflictResolution(
      serviceId,
      gameId,
      {
        configPath,
        registryPath,
        resolvedAt: Date.now(),
      },
    );

    if (!persisted) {
      return {
        ok: false,
        action,
        path: configPath,
        verification: verification.status,
        error: "App context is not available.",
        diagnostics,
      };
    }

    logger.log(
      `[Registry] User kept launcher install path for ${gameId} (${serviceId}); registry path remains unchanged.`,
    );

    return {
      ok: true,
      action,
      path: configPath,
      diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
    };
  }

  const written = await writeRegistryInstallPath(serviceId, gameId, configPath);
  if (!written) {
    return {
      ok: false,
      action,
      path: configPath,
      verification: verification.status,
      error: "Failed to update registry install path.",
      diagnostics,
    };
  }

  await persistGameInstallPathConflictResolution(serviceId, gameId, null);

  logger.log(
    `[Registry] Updated registry install path for ${gameId} (${serviceId}) from launcher config path.`,
  );

  return {
    ok: true,
    action,
    path: configPath,
    diagnostics: await getGameInstallPathDiagnostics(serviceId, gameId),
  };
};

/**
 * Identify the installation path of the game from saved config, then Registry.
 */
export const getGameInstallPath = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<string | null> => {
  const resolution = await resolveGameInstallPath(serviceId, gameId);

  if (!resolution.path) {
    logInstallPathResolutionFailure(serviceId, gameId, resolution);
  }

  return resolution.path;
};

/**
 * Reads the DaumGameStarter protocol command
 * Default key (empty string name) in HKCR
 */
export const getDaumGameStarterCommand = async (): Promise<string | null> => {
  const finalPath = standardizeRegPath(DAUM_STARTER_PROTOCOL_KEY);
  // Most robust way to get (Default) value across all hives
  const psCommand = `
    if (Test-Path "${finalPath}") {
      (Get-Item -Path "${finalPath}").GetValue("")
    }
  `.trim();
  const { stdout, code } = await runPowerShell(psCommand);
  return code === 0 && stdout ? stdout.trim() : null;
};

/**
 * Updates the DaumGameStarter protocol command
 */
export const setDaumGameStarterCommand = async (
  command: string,
): Promise<boolean> => {
  // Try to write to both HKCU and HKLM to ensure override or machine-wide update
  const psCommand = `
    $ErrorActionPreference = "Stop"
    $paths = @(
      "Registry::HKEY_CURRENT_USER\\Software\\Classes\\daumgamestarter\\shell\\open\\command",
      "Registry::HKEY_LOCAL_MACHINE\\Software\\Classes\\daumgamestarter\\shell\\open\\command"
    )
    $success = $false
    foreach ($p in $paths) {
      if (Test-Path $p) {
        try {
          Set-Item -Path $p -Value "${command}" -Force
          $success = $true
        } catch {
          # Might fail due to permissions, continue to next path
        }
      }
    }
    
    if (-not $success) {
      # Fallback: create in HKCU as a user-level override
      $p = "Registry::HKEY_CURRENT_USER\\Software\\Classes\\daumgamestarter\\shell\\open\\command"
      New-Item -Path $p -Force | Out-Null
      Set-Item -Path $p -Value "${command}" -Force
      $success = $true
    }
    
    Write-Host "RESULT:$success"
  `.trim();
  const { stdout, code } = await runPowerShell(psCommand, true);
  return code === 0 && stdout.includes("RESULT:True");
};

/**
 * Checks if the game is installed by verifying the service-specific executable in the resolved folder.
 */
export const getGameInstallationStatus = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<GameInstallationStatus> => {
  const resolution = await resolveGameInstallPath(serviceId, gameId);

  if (resolution.path) return "installed";

  if (resolution.error) {
    logInstallPathResolutionFailure(serviceId, gameId, resolution);
    return "unknown";
  }

  if (resolution.verifyError) {
    logInstallPathResolutionFailure(serviceId, gameId, resolution);
    return "unknown";
  }

  logInstallPathResolutionFailure(serviceId, gameId, resolution);
  return "uninstalled";
};

export const isGameInstalled = async (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): Promise<boolean> => {
  return (await getGameInstallationStatus(serviceId, gameId)) === "installed";
};

/**
 * Synchronizes the app's installation path in the registry with the actual current execution path.
 * This is crucial for fixing the issue where manual move (copy-paste) causes updates to land in the old directory.
 */
export async function syncInstallLocation() {
  if (!app.isPackaged) return;

  try {
    const currentExePath = app.getPath("exe");
    const currentInstallDir = path.dirname(currentExePath);
    const exeName = path.basename(currentExePath);
    // [Fix] Use explicit Product Name from Build Configuration (Single Source of Truth)
    // @ts-expect-error - injected by vite
    const productName = __PRODUCT_NAME__;
    const uninstallerName = `Uninstall ${productName}.exe`;

    // [Strict] We only update if the key explicitly exists. No arbitrary creation.
    const targetKey = LAUNCHER_UNINSTALL_REG_KEY;

    // Verify key existence before doing anything
    const psCheckCommand = `Test-Path "${targetKey}"`;
    const { stdout: exists } = await runPowerShell(psCheckCommand);

    if (exists.trim().toLowerCase() !== "true") {
      logger.warn(
        `[Main] Registry key not found for ${productName}. Skipping sync to avoid registry pollution.`,
      );
      return;
    }

    const updates = [
      { key: "InstallLocation", value: currentInstallDir },
      {
        key: "UninstallString",
        value: `"${path.join(currentInstallDir, uninstallerName)}" /currentuser`,
      },
      {
        key: "QuietUninstallString",
        value: `"${path.join(currentInstallDir, uninstallerName)}" /currentuser /S`,
      },
      {
        key: "DisplayIcon",
        value: `${path.join(currentInstallDir, exeName)},0`,
      },
    ];

    for (const update of updates) {
      const currentValue = await readRegistryValue(targetKey, update.key);

      if (!currentValue) {
        logger.warn(
          `[Main] Registry Value for ${update.key} is missing. Restoring...`,
        );
        await writeRegistryValue(targetKey, update.key, update.value, false);
      } else if (currentValue !== update.value) {
        logger.log(
          `[Main] Updating ${update.key}: "${currentValue}" -> "${update.value}"`,
        );
        await writeRegistryValue(targetKey, update.key, update.value, false);
      } else {
        // Value matches, do strictly nothing
      }
    }

    // [New] Sync explicit App Key (HKCU\Software\{GUID}) for Updater/Auto-Patch
    const appKey = LAUNCHER_APP_REG_KEY;
    const { stdout: appKeyExists } = await runPowerShell(
      `Test-Path "${appKey}"`,
    );

    if (appKeyExists.trim().toLowerCase() === "true") {
      const currentAppPath = await readRegistryValue(appKey, "InstallLocation");
      if (currentAppPath !== currentInstallDir) {
        logger.log(
          `[Main] Updating App Registry InstallLocation: "${currentAppPath}" -> "${currentInstallDir}"`,
        );
        await writeRegistryValue(
          appKey,
          "InstallLocation",
          currentInstallDir,
          false,
        );
      }
    }
  } catch (error) {
    logger.error("[Main] Error during InstallLocation synchronization:", error);
  }
}
