import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";

import { logger } from "./logger";
import { PowerShellManager } from "./powershell";
import { isWineEnvironment } from "./wine";

/**
 * Get executable paths for a running process by name (Windows)
 * Uses PowerShell and WMI/CIM
 */
export const getProcessPaths = async (
  processName: string,
): Promise<string[]> => {
  if (isWineEnvironment()) {
    const infos = await getProcessesInfoViaProcScan([processName]);
    return [...new Set(infos.map((info) => info.path))];
  }

  try {
    // Check if PowerShell is available and use it robustly via execFile
    // Arg 1: Command string. We don't need outer quotes for valid execFile args usually.
    // Use JSON output for robust parsing of ProcessId and ExecutablePath
    // This ensures we detect the process even if ExecutablePath is null (permission issues)
    const psCommand = `Get-CimInstance Win32_Process -Filter "Name = '${processName}'" | Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress`;

    const { stdout, stderr } = await PowerShellManager.getInstance().execute(
      psCommand,
      false,
      true,
    );

    if (stderr) {
      logger.warn(`[getProcessPaths] stderr for ${processName}:`, stderr);
    }

    if (!stdout || !stdout.trim()) {
      return [];
    }

    // PowerShell ConvertTo-Json can return a single object or an array
    let result: unknown;
    try {
      result = JSON.parse(stdout);
    } catch (e) {
      logger.error(`[getProcessPaths] JSON Parse Error for ${processName}:`, e);
      return [];
    }

    const processes = Array.isArray(result) ? result : [result];

    // Extract paths.
    const paths: string[] = [];

    for (const p of processes) {
      if (p.ExecutablePath && typeof p.ExecutablePath === "string") {
        paths.push(p.ExecutablePath);
      } else {
        // Fallback: Try Get-Process if WMI failed (Permission issues?)
        // Get-Process uses name without .exe
        const nameInternal = processName.replace(/\.exe$/i, "");
        try {
          const fallbackCmd = `Get-Process -Name "${nameInternal}" | Select-Object -ExpandProperty Path | Select-Object -Unique`;
          const { stdout: fallbackOut } =
            await PowerShellManager.getInstance().execute(
              fallbackCmd,
              false,
              true,
            );

          if (fallbackOut && fallbackOut.trim()) {
            const fallbackPaths = fallbackOut
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0);
            paths.push(...fallbackPaths);
          } else {
            paths.push("");
          }
        } catch (_err) {
          // Fallback failed (likely Access Denied)
          paths.push("");
        }
      }
    }

    // Deduplicate
    return [...new Set(paths)];
  } catch (e) {
    logger.error(`[getProcessPaths] Error executing for ${processName}:`, e);
    return [];
  }
};

/**
 * Get info for multiple running processes by names (Windows)
 * Uses a single PowerShell/WMI query for efficiency.
 */
export interface ProcessInfo {
  pid: number;
  name: string;
  path: string;
}

export const getProcessesInfo = async (
  processNames: string[],
): Promise<ProcessInfo[]> => {
  if (processNames.length === 0) return [];

  if (isWineEnvironment()) {
    return getProcessesInfoViaProcScan(processNames);
  }

  try {
    // [Optimization] Use Get-Process instead of Get-CimInstance for polling.
    // WMI (CIM) is extremely slow and causes AppHangB1 in some environments.
    // Get-Process is much lighter.
    const names = processNames.map((n) => n.replace(/\.exe$/i, ""));
    const psCommand = `Get-Process -Name ${names.join(",")} -ErrorAction SilentlyContinue | Select-Object Id, Name, Path | ConvertTo-Json -Compress`;

    const { stdout } = await PowerShellManager.getInstance().execute(
      psCommand,
      false,
      true,
    );

    if (!stdout || !stdout.trim()) {
      return [];
    }

    let result: unknown;
    try {
      result = JSON.parse(stdout);
    } catch (_e) {
      return [];
    }

    const rawProcesses = Array.isArray(result) ? result : [result];
    const processes: ProcessInfo[] = [];

    for (const p of rawProcesses) {
      if (!p || typeof p.Id !== "number") continue;

      processes.push({
        pid: p.Id,
        name: p.Name ? `${p.Name}.exe` : "",
        path: p.Path || "",
      });
    }

    return processes;
  } catch (_e) {
    return [];
  }
};

/**
 * Check if a process is running by name
 */
export const isProcessRunning = async (
  processName: string,
): Promise<boolean> => {
  const paths = await getProcessPaths(processName);
  return paths.length > 0;
};

/**
 * [SteamDeck] Wine/Proton용 프로세스 열거 폴백.
 *
 * Wine은 리눅스 루트를 Z:\ 드라이브로 매핑하므로 Z:\proc\<pid>\cmdline을
 * 읽어 같은 프리픽스에서 실행 중인 게임 프로세스를 찾을 수 있다.
 *
 * 주의: 여기서 얻는 pid는 "리눅스" pid라서 taskkill /PID 등 Windows pid를
 * 기대하는 API에는 쓸 수 없다 (이름 기반 taskkill /IM은 사용 가능).
 */
const getProcessesInfoViaProcScan = async (
  processNames: string[],
): Promise<ProcessInfo[]> => {
  const targets = processNames.map((n) => n.toLowerCase());
  const processes: ProcessInfo[] = [];

  let entries: string[];
  try {
    entries = await fsp.readdir("Z:\\proc");
  } catch (e) {
    logger.warn("[getProcessesInfoViaProcScan] Unable to read Z:\\proc:", e);
    return [];
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;

    let cmdline: string;
    try {
      cmdline = await fsp.readFile(`Z:\\proc\\${entry}\\cmdline`, "utf8");
    } catch (_e) {
      continue; // 프로세스가 이미 종료됐거나 접근 불가
    }

    // Only Wine loaders may identify their executable through argv[1].
    // Proton's lingering steam.exe also receives the game path as argv[1],
    // but is not the game and must not keep its status stuck at running.
    const args = cmdline.split("\0").filter(Boolean);
    const loader = args[0]?.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    const isWineLoader = /^(?:wine(?:64)?|wine(?:64)?-preloader)$/.test(loader);
    for (const arg of args.slice(0, isWineLoader ? 2 : 1)) {
      const basename = arg.split(/[\\/]/).pop()?.toLowerCase() ?? "";
      const matched = targets.find((t) => basename === t);
      if (matched) {
        processes.push({ pid: Number(entry), name: matched, path: arg });
        break;
      }
    }
  }

  return processes;
};

/**
 * [SteamDeck] taskkill.exe 직접 실행 (PowerShell 세션 미경유).
 * Wine에도 taskkill.exe는 존재하므로 이름 기반(/IM) 종료에 사용한다.
 * 실패해도 예외를 던지지 않는다 (fire-and-forget).
 */
export const runTaskkillDirect = (args: string[]): Promise<boolean> => {
  return new Promise((resolve) => {
    execFile(
      "taskkill.exe",
      args,
      { windowsHide: true, timeout: 10000 },
      (error) => {
        if (error) {
          logger.warn(`[runTaskkillDirect] taskkill ${args.join(" ")}:`, error);
        }
        resolve(!error);
      },
    );
  });
};
