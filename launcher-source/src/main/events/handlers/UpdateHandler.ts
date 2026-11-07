import axios from "axios";
import { app } from "electron";
import { autoUpdater } from "electron-updater";

import { UpdateStatus } from "../../../shared/types";
import { changelogService } from "../../services/ChangelogService";
import { logger } from "../../utils/logger";
import { PowerShellManager } from "../../utils/powershell";
import { isWineEnvironment } from "../../utils/wine";
import {
  AppContext,
  EventHandler,
  EventType,
  UIUpdateCheckEvent,
  UIUpdateDownloadEvent,
  UIUpdateInstallEvent,
} from "../types";

// Configure autoUpdater
autoUpdater.autoDownload = false; // Manual download trigger required
// [SteamDeck] Wine/Proton에서는 앱 종료 시 NSIS 설치파일을 자동 실행하면
// electron-builder의 "앱 실행 중" 검사에 걸려 "수동으로 닫아라" 대화상자가
// 무한 루프에 빠질 수 있다. 자동 설치는 끄고, 업데이트는 사용자가 명시적으로
// 설치 버튼을 눌렀을 때만 진행한다.
autoUpdater.autoInstallOnAppQuit = !isWineEnvironment();

// Prevent duplicate listeners
let isListenerAttached = false;
let currentCheckIsSilent = false;
let lastEmittedPercent = -1; // For throttling progress updates

const TRANSIENT_UPDATE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const UPDATE_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_NETWORK",
  "ETIMEDOUT",
]);
const UPDATE_NETWORK_MESSAGE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /internet.*disconnected/i,
  /net::ERR_/i,
] as const;

const isExpectedUpdateNetworkError = (error: unknown): boolean => {
  const httpStatus = getUpdateErrorHttpStatus(error);
  if (
    httpStatus !== undefined &&
    TRANSIENT_UPDATE_HTTP_STATUSES.has(httpStatus)
  ) {
    return true;
  }

  const code = getUpdateErrorCode(error);
  if (code && UPDATE_NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getUpdateErrorMessage(error);
  return UPDATE_NETWORK_MESSAGE_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
};

const isGitHubRateLimitError = (error: unknown): boolean =>
  getUpdateErrorHttpStatus(error) === 403;

const describeUpdateError = (error: unknown): string => {
  const code = getUpdateErrorCode(error);
  const httpStatus = getUpdateErrorHttpStatus(error);
  const message = getUpdateErrorMessage(error);
  const parts: string[] = [];

  if (code) parts.push(code);
  if (httpStatus !== undefined) parts.push(`HTTP ${httpStatus}`);
  if (message) parts.push(message);

  return parts.length > 0 ? parts.join(": ") : "unknown network error";
};

const warnExpectedUpdateNetworkError = (
  phase: string,
  error: unknown,
  suffix: string,
) => {
  logger.warn(
    `[UpdateHandler] ${phase} could not reach update server (${describeUpdateError(error)}). ${suffix}`,
  );
};

function getUpdateErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function getUpdateErrorHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const response = error.response;
  if (!isRecord(response)) return undefined;
  return typeof response.status === "number" ? response.status : undefined;
}

function getUpdateErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const sendStatus = (context: AppContext, status: UpdateStatus) => {
  const win = context.mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send("update-status-change", {
      ...status,
      isSilent: currentCheckIsSilent,
    });
  }
};

const attachUpdateListeners = (context: AppContext) => {
  if (isListenerAttached) return;

  autoUpdater.on("checking-for-update", () => {
    logger.log("[UpdateHandler] Checking for updates...");
    sendStatus(context, { state: "checking" });
  });

  let lastVersionInfo = "";

  autoUpdater.on("update-available", async (info) => {
    lastVersionInfo = info.version; // Store version for progress updates
    logger.log(
      `[UpdateHandler] Update available: ${info.version} (Current: ${app.getVersion()}, Silent: ${currentCheckIsSilent})`,
    );

    // Fetch changelogs for the update
    const changelogs = await changelogService.fetchChangelogs(
      info.version,
      app.getVersion(),
    );

    sendStatus(context, {
      state: "available",
      version: info.version,
      changelogs,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    logger.log(
      `[UpdateHandler] Update not available. (Current: ${app.getVersion()}, Latest: ${info.version})`,
    );
    sendStatus(context, { state: "idle" });
  });

  autoUpdater.on("error", (err) => {
    if (isExpectedUpdateNetworkError(err)) {
      warnExpectedUpdateNetworkError(
        "Update check",
        err,
        "Will retry on the next check.",
      );
    } else {
      logger.error("[UpdateHandler] Update error:", err);
    }
    sendStatus(context, { state: "idle" });
  });

  autoUpdater.on("download-progress", (progressObj) => {
    // Only send updates if percent increased by at least 10%
    // to prevent flooding the event bus and UI logs.
    const currentPercent = Math.floor(progressObj.percent / 10) * 10;
    if (currentPercent !== lastEmittedPercent) {
      lastEmittedPercent = currentPercent;
      sendStatus(context, {
        state: "downloading",
        progress: progressObj.percent,
        version: lastVersionInfo,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    logger.log(`[UpdateHandler] Update downloaded: ${info.version}`);
    sendStatus(context, { state: "downloaded", version: info.version });
    lastEmittedPercent = -1; // Reset for next time
  });

  isListenerAttached = true;
};

/**
 * Checks for updates smartly by verifying the tag first via GitHub API.
 * This prevents unnecessary downloads of `latest.yml` which inflates download counts.
 */
const checkForUpdatesSmart = async () => {
  try {
    // [SteamDeck] 업데이트는 이 포크의 릴리즈에서 받는다 (app-update.yml의
    // publish 설정과 일치시켜, 사전 태그 확인도 같은 저장소를 보게 한다).
    const repo = "psp3322/POE2-unofficial-launcher-for-steamdeck";
    const url = `https://api.github.com/repos/${repo}/releases/latest`;

    logger.log(
      `[UpdateHandler] Smart Check: Fetching latest release from ${url}`,
    );
    const response = await axios.get(url, { timeout: 5000 });

    if (response.status === 200 && response.data?.tag_name) {
      const latestTag = response.data.tag_name; // e.g., "v0.7.0" or "0.7.0"
      const currentVersion = app.getVersion();

      // Remove 'v' prefix for comparison if present
      const cleanLatest = latestTag.replace(/^v/, "");
      const cleanCurrent = currentVersion.replace(/^v/, "");

      logger.log(
        `[UpdateHandler] Smart Check: Latest=${cleanLatest}, Current=${cleanCurrent}`,
      );

      // Simple string comparison for now as versions are strictly numeric + dots
      // In a real semver scenario, we'd use 'semver' package, but let's assume standard format.
      // Actually, simple string comparison "0.7.0" vs "0.6.3" works, but "0.10.0" < "0.9.0" in string.
      // We should be careful. Let's split and compare numbers.
      const parseVersion = (v: string) => v.split(".").map(Number);
      const [lMa, lMi, lPa] = parseVersion(cleanLatest);
      const [cMa, cMi, cPa] = parseVersion(cleanCurrent);

      let isNewer = false;
      if (lMa > cMa) isNewer = true;
      else if (lMa === cMa && lMi > cMi) isNewer = true;
      else if (lMa === cMa && lMi === cMi && lPa > cPa) isNewer = true;

      if (!isNewer) {
        logger.log(
          "[UpdateHandler] Smart Check: App is up to date (or newer). Skipping autoUpdater.",
        );
        return; // EXIT: Do not trigger autoUpdater
      }

      logger.log(
        "[UpdateHandler] Smart Check: New version detected. Triggering autoUpdater...",
      );
    }
  } catch (e: unknown) {
    if (isGitHubRateLimitError(e)) {
      logger.warn(
        "[UpdateHandler] GitHub API Rate Limit exceeded (403). Falling back to standard check.",
      );
    } else if (isExpectedUpdateNetworkError(e)) {
      warnExpectedUpdateNetworkError(
        "Smart Check",
        e,
        "Falling back to standard check.",
      );
    } else {
      logger.error(
        "[UpdateHandler] Smart Check failed. Falling back to standard check.",
        e,
      );
    }
  }

  // Fallback or explicit update required
  await autoUpdater.checkForUpdates();
};

/**
 * Triggers an update check immediately.
 * @param context App context
 * @param isSilent Whether to suppress UI popups if an update is found
 */
export const triggerUpdateCheck = async (
  context: AppContext,
  isSilent = false,
) => {
  if (!app.isPackaged || process.env.VITE_DEV_SERVER_URL) {
    logger.log(`[UpdateHandler] Skipping update check in development mode.`);
    return;
  }

  logger.log(
    `[UpdateHandler] Manual/Triggered update check (isSilent: ${isSilent})`,
  );
  currentCheckIsSilent = isSilent;
  attachUpdateListeners(context);

  try {
    await checkForUpdatesSmart();
  } catch (e) {
    if (isExpectedUpdateNetworkError(e)) {
      warnExpectedUpdateNetworkError(
        "Update check",
        e,
        "Will retry on the next check.",
      );
    } else {
      logger.error("[UpdateHandler] Failed check:", e);
    }
  }
};

/**
 * Handler: Check for Updates
 */
export const UpdateCheckHandler: EventHandler<UIUpdateCheckEvent> = {
  id: "UpdateCheckHandler",
  targetEvent: EventType.UI_UPDATE_CHECK,

  condition: () => true,

  handle: async (event, context: AppContext) => {
    const isSilent = event.payload?.isSilent ?? false;
    await triggerUpdateCheck(context, isSilent);
  },
};

/**
 * Handler: Start Download
 */
export const UpdateDownloadHandler: EventHandler<UIUpdateDownloadEvent> = {
  id: "UpdateDownloadHandler",
  targetEvent: EventType.UI_UPDATE_DOWNLOAD,

  condition: () => true,

  handle: async (_event, context: AppContext) => {
    logger.log("[UpdateHandler] Requesting download...");
    currentCheckIsSilent = false; // Downloading is usually explicit
    attachUpdateListeners(context);
    await autoUpdater.downloadUpdate();
  },
};

/**
 * Handler: Install & Restart
 */
export const UpdateInstallHandler: EventHandler<UIUpdateInstallEvent> = {
  id: "UpdateInstallHandler",
  targetEvent: EventType.UI_UPDATE_INSTALL,

  condition: () => true,

  handle: async (event, _context: AppContext) => {
    const isSilent = event.payload?.isSilent ?? true;

    logger.log(
      `[UpdateHandler] Requesting install & quit... (isSilent: ${isSilent}, Current EXE: ${app.getPath("exe")})`,
    );

    if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
      logger.log(
        "[UpdateHandler] Dev mode detected. Skipping actual quitAndInstall.",
      );
      return;
    }

    // [Safety] Cleanup PowerShell sessions before quitting to ensure no file locks
    try {
      PowerShellManager.getInstance().cleanup();
    } catch (e) {
      logger.error("[UpdateHandler] Failed to cleanup PowerShell sessions:", e);
    }

    autoUpdater.quitAndInstall(isSilent, true);
  },
};
