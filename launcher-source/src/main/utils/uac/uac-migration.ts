import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

import { app } from "electron";

import { logger } from "../logger";
import { PowerShellManager } from "../powershell";
import { isWineEnvironment } from "../wine";
import {
  getKakaoGameStarterMigrationRequest,
  isAnyStarterRunAsInvokerEnabled,
  isStarterMissingRunAsInvoker,
  parseWindowsExecutableCommand,
  resolveInstalledKakaoGameStarters,
  type KakaoGameStarterId,
  type KakaoGameStarterUacStatus,
  type ResolvedKakaoGameStarter,
} from "./kakao-game-starter";

// --- Constants ---
const REG_PROTOCOL_KEY =
  "HKCU:\\Software\\Classes\\daumgamestarter\\shell\\open\\command";
const REG_LAYERS_KEY =
  "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";
const TASK_NAME = "SkipDaumGameStarterUAC";
const RUNASINVOKER_LAYER = "RUNASINVOKER";

// New Work Dir for Migration (Temporary storage if needed)
/**
 * Directory for legacy UAC bypass files (proxy.vbs, etc.)
 * Note: This function only returns the path and DOES NOT create the directory.
 * This prevents detectLegacy() from triggering false positives.
 */
function getLegacyWorkDirectory(): string {
  return join(app.getPath("userData"), "uac_bypass");
}

/**
 * Directory for the new UAC cleaner/uninstaller scripts.
 * Use a separate name from "uac_bypass" to avoid triggering legacy migration prompts.
 */
function getUacCleanerDirectory(): string {
  const workDir = join(app.getPath("userData"), "daumgamestarter_uac");
  if (!existsSync(workDir)) {
    try {
      mkdirSync(workDir, { recursive: true });
    } catch (e) {
      logger.error("[UAC] Failed to create cleaner directory:", e);
    }
  }
  return workDir;
}

// --- Helper: Get Registry Value ---
async function getRegValue(
  path: string,
  name: string = "(default)",
): Promise<string | null> {
  try {
    const cmd = `Get-ItemProperty -Path "${path}" -Name "${name}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty "${name}"`;
    const result = await PowerShellManager.getInstance().execute(cmd, false);
    if (result.code === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch (_e) {
    // Fixed: _e
    // Ignore error
  }
  return null;
}

// ==========================================
// 1. Legacy Detection & Cleanup
// ==========================================

export const LegacyUacManager = {
  /**
   * Detect if Legacy Bypass (Proxy/Scheduler) is active.
   */
  async detectLegacy(): Promise<boolean> {
    logger.log("[UAC-Migration] Starting Legacy Detection...");

    // 1. Check Registry
    const cmd = await getRegValue(REG_PROTOCOL_KEY);
    if (cmd && cmd.toLowerCase().includes("proxy.vbs")) {
      logger.log("[UAC-Migration] Detected Legacy: proxy.vbs in registry.");
      return true;
    }

    // 2. Check Task
    const taskNames = [TASK_NAME];
    for (const task of taskNames) {
      const taskCheck = await PowerShellManager.getInstance().execute(
        `Get-ScheduledTask -TaskName "${task}" -ErrorAction SilentlyContinue`,
        false,
      );
      if (
        taskCheck.code === 0 &&
        taskCheck.stdout &&
        taskCheck.stdout.trim().length > 0
      ) {
        logger.log(
          `[UAC-Migration] Detected Legacy: Scheduled Task exists (${task}).`,
        );
        return true;
      }
    }

    // 3. Check Legacy Folder (Garbage Collection)
    // Validate existence WITHOUT creating it (getWorkDirectory generates it if missing)
    const workDir = getLegacyWorkDirectory();
    if (existsSync(workDir)) {
      logger.log(
        `[UAC-Migration] Detected Legacy: Folder exists at ${workDir}`,
      );
      return true;
    }

    logger.log("[UAC-Migration] No legacy traces found.");
    return false;
  },

  /**
   * Remove Legacy Bypass (Delete Task, Restore Registry, Delete Files).
   */
  async cleanupLegacy(): Promise<boolean> {
    logger.log("[UAC-Migration] Cleaning up legacy bypass...");

    try {
      // 1. Delete Task (Force) - Check both known names
      const taskNames = [TASK_NAME];

      for (const task of taskNames) {
        logger.log(
          `[UAC-Migration] Attempting to remove scheduled task: ${task}`,
        );
        const deleteResult = await PowerShellManager.getInstance().execute(
          `Unregister-ScheduledTask -TaskName "${task}" -Confirm:$false -ErrorAction Stop`,
          true, // Elevated
        );

        if (deleteResult.code !== 0) {
          // Ignorable error if task doesn't exist, but we should log it
          if (!deleteResult.stderr.includes("MSFT_ScheduledTask")) {
            logger.error(
              `[UAC-Migration] Failed to delete task (${task}): ${deleteResult.stderr}`,
            );
          } else {
            logger.log(
              `[UAC-Migration] Task (${task}) already removed (not found).`,
            );
          }
        } else {
          // Even if code is 0, check stderr for "Task not found" warnings (PowerShell weirdness)
          if (
            deleteResult.stderr &&
            deleteResult.stderr.includes("MSFT_ScheduledTask")
          ) {
            logger.log(
              `[UAC-Migration] Task (${task}) verified missing (not found).`,
            );
          } else {
            logger.log(
              `[UAC-Migration] Scheduled Task (${task}) removed successfully.`,
            );
          }
        }
      }

      // 2. Restore Registry
      const currentCmd = await getRegValue(REG_PROTOCOL_KEY);
      const workDir = getLegacyWorkDirectory();

      if (currentCmd && currentCmd.toLowerCase().includes("proxy.vbs")) {
        // Try to find backup
        const backupPath = join(workDir, "original_command.txt");
        let originalCmd = "";

        if (existsSync(backupPath)) {
          originalCmd = readFileSync(backupPath, "utf8").trim();
        } else {
          // Fallback guess: Try to find DaumGameStarter in standard paths?
          // For now, if no backup, we define a standard guess or rely on user reinstall.
          // Or we can try to find the exe path from the 'runner.vbs' if it exists.
          logger.warn(
            "[UAC-Migration] No backup found. Attempting to restore from common path is risky. Skipping registry restore (Manual fix might be needed if original is lost).",
          );
          // TODO: Improve this if needed. But usually, if we just delete the proxy, it breaks.
          // Wait, if we use RUNASINVOKER, we MUST restore the original command to point to the EXE.
          // Let's try to parse 'launch_args.txt' or 'runner.vbs' implemented in previous version?
          // Actually, let's look for "DaumGameStarter.exe" in standard location if backup fails?
          // Default: "C:\DaumGames\DaumGameStarter\daumgamestarter.exe" "%1"
          const defaultPath =
            "C:\\DaumGames\\DaumGameStarter\\daumgamestarter.exe";
          if (existsSync(defaultPath)) {
            originalCmd = `"${defaultPath}" "%1"`;
          }
        }

        if (originalCmd) {
          // Restore
          const script = `Set-ItemProperty -Path "${REG_PROTOCOL_KEY}" -Name "(default)" -Value '${originalCmd}'`;
          await PowerShellManager.getInstance().execute(script, false);
          logger.log("[UAC-Migration] Registry restored to:", originalCmd);
        }
      }

      // 3. Delete Files (uac_bypass dir)
      if (existsSync(workDir)) {
        rmSync(workDir, { recursive: true, force: true });
        logger.log("[UAC-Migration] Working directory deleted.");
      }

      return true;
    } catch (e) {
      logger.error("[UAC-Migration] Cleanup failed:", e);
      return false;
    }
  },
};

// ==========================================
// 2. New RUNASINVOKER Bypass
// ==========================================

export const SimpleUacBypass = {
  /**
   * Apply or remove RUNASINVOKER for every installed Kakao Games starter.
   */
  async setRunAsInvoker(enable: boolean): Promise<boolean> {
    const starters = await resolveInstalledKakaoGameStarters(getRegValue);
    return setRunAsInvokerForStarters(starters, enable);
  },

  async setKakaoGamesStarterRunAsInvoker(enable: boolean): Promise<boolean> {
    const starters = await getInstalledStartersById(["kakaogames"]);
    return setRunAsInvokerForStarters(starters, enable);
  },

  async setDaumGameStarterRunAsInvoker(enable: boolean): Promise<boolean> {
    const starters = await getInstalledStartersById(["daum"]);
    return setRunAsInvokerForStarters(starters, enable);
  },

  async isRunAsInvokerEnabled(): Promise<boolean> {
    // [SteamDeck] Wine에는 UAC가 없으므로 항상 "적용됨"으로 취급
    if (isWineEnvironment()) return true;

    const statuses = await getStarterUacStatuses();
    const isEnabled = isAnyStarterRunAsInvokerEnabled(statuses);

    logger.log(
      `[SimpleUac] Check Status: ${isEnabled} (${formatStarterStatuses(
        statuses,
      )})`,
    );

    return isEnabled;
  },

  async isKakaoGamesStarterMissingRunAsInvoker(): Promise<boolean> {
    return isInstalledStarterMissingRunAsInvoker("kakaogames");
  },

  async isDaumGameStarterMissingRunAsInvoker(): Promise<boolean> {
    return isInstalledStarterMissingRunAsInvoker("daum");
  },
};

export const KakaoGameStarterMigration = {
  async getRequest() {
    const starters = await resolveInstalledKakaoGameStarters(getRegValue);
    return getKakaoGameStarterMigrationRequest(starters);
  },

  async uninstallDaumGameStarter(): Promise<boolean> {
    const uninstallCommand = await findDaumGameStarterUninstallCommand();

    if (!uninstallCommand) {
      logger.warn(
        "[KakaoGameStarterMigration] DaumGameStarter uninstall command was not found.",
      );
      return false;
    }

    const parsed = parseWindowsExecutableCommand(uninstallCommand);

    if (!parsed) {
      logger.warn(
        `[KakaoGameStarterMigration] Could not parse DaumGameStarter uninstall command: ${uninstallCommand}`,
      );
      return false;
    }

    const script = [
      `$filePath = '${escapePowerShellSingleQuotedString(parsed.filePath)}'`,
      `$arguments = '${escapePowerShellSingleQuotedString(parsed.arguments)}'`,
      "if ([string]::IsNullOrWhiteSpace($arguments)) {",
      "  Start-Process -FilePath $filePath -ErrorAction Stop",
      "} else {",
      "  Start-Process -FilePath $filePath -ArgumentList $arguments -ErrorAction Stop",
      "}",
    ].join("\n");

    const result = await PowerShellManager.getInstance().execute(script, false);

    if (result.code !== 0) {
      logger.error(
        `[KakaoGameStarterMigration] Failed to start DaumGameStarter uninstaller: ${result.stderr}`,
      );
      return false;
    }

    logger.log(
      `[KakaoGameStarterMigration] Started DaumGameStarter uninstaller: ${uninstallCommand}`,
    );
    return true;
  },
};

async function setRunAsInvokerForStarters(
  starters: ResolvedKakaoGameStarter[],
  enable: boolean,
): Promise<boolean> {
  // [SteamDeck] Wine에는 UAC가 없어서 승격 팝업 자체가 발생하지 않는다.
  // RUNASINVOKER 설정의 목적(팝업 제거)이 이미 달성된 상태이므로 성공으로 처리.
  if (isWineEnvironment()) {
    logger.log(
      "[SimpleUac] Wine/Proton detected: UAC does not exist here, treating RUNASINVOKER as already applied.",
    );
    return true;
  }

  if (starters.length === 0) {
    logger.error(
      "[SimpleUac] Aborting RUNASINVOKER configuration: no matching Kakao Games starter executable found.",
    );
    return false;
  }

  try {
    const cleanerDir = getUacCleanerDirectory();
    const uninstallBatPath = join(cleanerDir, "uninstall_uac.bat");

    if (enable) {
      // Ensure Key Exists
      const ensureKeyCmd = `if (-not (Test-Path "${REG_LAYERS_KEY}")) { New-Item -Path "${REG_LAYERS_KEY}" -Force }`;
      await PowerShellManager.getInstance().execute(ensureKeyCmd, false);

      for (const starter of starters) {
        const cmd = `Set-ItemProperty -Path "${REG_LAYERS_KEY}" -Name "${starter.exePath}" -Value "${RUNASINVOKER_LAYER}" -Force`;
        const result = await PowerShellManager.getInstance().execute(
          cmd,
          false,
        );
        if (result.code !== 0) {
          logger.error(
            `[SimpleUac] Failed to apply RUNASINVOKER to ${starter.label}: ${result.stderr}`,
          );
          return false;
        }

        logger.log(
          `[SimpleUac] Applied RUNASINVOKER to ${starter.label}: ${starter.exePath}`,
        );
      }

      // Generate uninstall script for NSIS uninstaller
      // We use batch file so NSIS can run it easily without JS environment
      const allInstalledStarters =
        await resolveInstalledKakaoGameStarters(getRegValue);
      const batKey = REG_LAYERS_KEY.replace("HKCU:\\", "HKCU\\");
      const batContent = [
        "@echo off",
        ...allInstalledStarters.map(
          (starter) => `reg delete "${batKey}" /v "${starter.exePath}" /f`,
        ),
        "",
      ].join("\r\n");
      writeFileSync(uninstallBatPath, batContent, "utf8");
      logger.log(`[SimpleUac] Generated uninstall script: ${uninstallBatPath}`);
    } else {
      for (const starter of starters) {
        const cmd = `Remove-ItemProperty -Path "${REG_LAYERS_KEY}" -Name "${starter.exePath}" -ErrorAction SilentlyContinue`;
        const result = await PowerShellManager.getInstance().execute(
          cmd,
          false,
        );
        if (result.code !== 0) {
          logger.error(
            `[SimpleUac] Failed to remove RUNASINVOKER from ${starter.label}: ${result.stderr}`,
          );
          return false;
        }

        logger.log(
          `[SimpleUac] Removed RUNASINVOKER from ${starter.label}: ${starter.exePath}`,
        );
      }

      // Cleanup uninstall script
      if (existsSync(uninstallBatPath)) {
        rmSync(uninstallBatPath, { force: true });
        logger.log("[SimpleUac] Removed uninstall script.");
      }
    }
    return true;
  } catch (e) {
    logger.error("[SimpleUac] Failed to set registry:", e);
    return false;
  }
}

async function getInstalledStartersById(
  ids: KakaoGameStarterId[],
): Promise<ResolvedKakaoGameStarter[]> {
  const idSet = new Set(ids);
  const starters = await resolveInstalledKakaoGameStarters(getRegValue);
  return starters.filter((starter) => idSet.has(starter.id));
}

async function getStarterUacStatuses(): Promise<KakaoGameStarterUacStatus[]> {
  const starters = await resolveInstalledKakaoGameStarters(getRegValue);
  const statuses: KakaoGameStarterUacStatus[] = [];

  for (const starter of starters) {
    const value = await getRegValue(REG_LAYERS_KEY, starter.exePath);
    statuses.push({
      ...starter,
      runAsInvokerEnabled: value?.includes(RUNASINVOKER_LAYER) ?? false,
    });
  }

  return statuses;
}

async function isInstalledStarterMissingRunAsInvoker(
  id: KakaoGameStarterId,
): Promise<boolean> {
  const statuses = await getStarterUacStatuses();
  return isStarterMissingRunAsInvoker(statuses, id);
}

function formatStarterStatuses(statuses: KakaoGameStarterUacStatus[]): string {
  if (statuses.length === 0) return "no installed starter";

  return statuses
    .map(
      (starter) =>
        `${starter.label}: ${
          starter.runAsInvokerEnabled ? "RUNASINVOKER" : "missing"
        } (${starter.exePath})`,
    )
    .join(", ");
}

async function findDaumGameStarterUninstallCommand(): Promise<string | null> {
  const script = `
$roots = @(
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
)

$entries = foreach ($root in $roots) {
  Get-ItemProperty -Path $root -ErrorAction SilentlyContinue
}

$target = $entries | Where-Object {
  $text = @(
    $_.DisplayName,
    $_.Publisher,
    $_.InstallLocation,
    $_.UninstallString,
    $_.QuietUninstallString
  ) -join "\`n"

  $text -match "(?i)(DaumGameStarter|Daum Game Starter|DaumGames|다음게임 스타터|다음 게임 스타터)"
} | Select-Object -First 1

if ($null -ne $target) {
  if ($target.UninstallString) {
    $target.UninstallString
  } elseif ($target.QuietUninstallString) {
    $target.QuietUninstallString
  }
}
`;

  const result = await PowerShellManager.getInstance().execute(
    script,
    false,
    true,
  );

  if (result.code !== 0) {
    logger.error(
      `[KakaoGameStarterMigration] Failed to query DaumGameStarter uninstall command: ${result.stderr}`,
    );
    return null;
  }

  return result.stdout.trim() || null;
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}
