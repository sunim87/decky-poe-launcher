import fs from "node:fs/promises";
import path from "node:path";

import { app, type BrowserWindow } from "electron";
import JSZip from "jszip";

import { logger } from "../utils/logger";

import type { AppConfig, GameStatusState } from "../../shared/types";
import type { Dirent } from "node:fs";

type AutomationPageDumpOptions = {
  reason: string;
  triggerContext?: string;
  mainWindow?: BrowserWindow | null;
  debugWindow?: BrowserWindow | null;
};

type PageSnapshot = {
  title: string;
  url: string;
  readyState: string;
  bodyText: string;
  html: string;
};

type AutomationDumpSession = {
  id: string;
  startedAt: number;
  gameId: AppConfig["activeGame"];
  serviceId: AppConfig["serviceChannel"];
  triggerContext?: string;
  dumpCount: number;
};

type AutomationDumpOutput = {
  primaryDir: string;
  mirrorDir?: string;
  archiveDir: string;
  mirrorArchiveDir?: string;
};

export type AutomationDumpArchiveResult = {
  archivePath: string;
  mirrorArchivePath: string | null;
};

type ArchiveAutomationDumpSessionOptions = {
  logResult?: boolean;
};

const MIN_DUMP_INTERVAL_MS = 1000;
const DUMP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMP_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_REMOVE_MAX_RETRIES = 5;
const DIRECTORY_REMOVE_RETRY_DELAY_MS = 100;
const RETRIABLE_DIRECTORY_REMOVE_ERRORS = new Set([
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
]);
const lastDumpAtByKey = new Map<string, number>();
let activeSession: AutomationDumpSession | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

export function isAutomationPageDumpEnabled() {
  const explicit = process.env.VITE_KAKAO_PAGE_DUMP;
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  return true;
}

export function startAutomationDumpSession(input: {
  gameId: AppConfig["activeGame"];
  serviceId: AppConfig["serviceChannel"];
  triggerContext?: string;
}) {
  if (!isAutomationPageDumpEnabled() || input.serviceId !== "Kakao Games") {
    return;
  }

  if (activeSession) {
    void discardAutomationDumpSession("new-session-started");
  }

  const startedAt = Date.now();
  activeSession = {
    id: `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}_${input.gameId}`,
    startedAt,
    gameId: input.gameId,
    serviceId: input.serviceId,
    triggerContext: input.triggerContext,
    dumpCount: 0,
  };

  logger.log(
    `[KakaoPageDump] Started diagnostic dump session: ${activeSession.id}`,
  );
}

export async function handleAutomationDumpGameStatus(status: GameStatusState) {
  if (!activeSession) return;
  if (
    activeSession.gameId !== status.gameId ||
    activeSession.serviceId !== status.serviceId
  ) {
    return;
  }

  if (status.status === "running") {
    await discardAutomationDumpSession("game-started");
    return;
  }

  if (status.status === "error") {
    await archiveAutomationDumpSession(
      status.errorCode ? `status-error-${status.errorCode}` : "status-error",
    );
    return;
  }

  if (
    status.status === "idle" ||
    status.status === "uninstalled" ||
    status.status === "install_check_blocked"
  ) {
    await discardAutomationDumpSession(`status-${status.status}`);
  }
}

export async function discardAutomationDumpSession(reason: string) {
  const session = activeSession;
  if (!session) return;
  activeSession = null;

  const output = getAutomationDumpOutput(session);
  await removeDirectory(output.primaryDir);
  if (output.mirrorDir) {
    await removeDirectory(output.mirrorDir);
  }

  logger.log(
    `[KakaoPageDump] Discarded diagnostic dump session (${reason}): ${session.id}`,
  );
}

export async function archiveAutomationDumpSession(
  reason: string,
  options: ArchiveAutomationDumpSessionOptions = {},
): Promise<AutomationDumpArchiveResult | null> {
  const shouldLogResult = options.logResult !== false;
  const session = activeSession;
  if (!session) return null;
  activeSession = null;

  const output = getAutomationDumpOutput(session);
  const hasPrimaryFiles = await hasFiles(output.primaryDir);

  if (!hasPrimaryFiles) {
    await removeDirectory(output.primaryDir);
    if (output.mirrorDir) {
      await removeDirectory(output.mirrorDir);
    }
    logger.log(
      `[KakaoPageDump] No diagnostic dump files to archive (${reason}).`,
    );
    return null;
  }

  const archivePath = await createDumpArchive(
    output.primaryDir,
    output.archiveDir,
    session,
    reason,
  );

  let mirrorArchivePath: string | null = null;
  if (output.mirrorDir && output.mirrorArchiveDir) {
    mirrorArchivePath = await createDumpArchive(
      output.mirrorDir,
      output.mirrorArchiveDir,
      session,
      reason,
    );
  }

  await removeDirectory(output.primaryDir);
  if (output.mirrorDir) {
    await removeDirectory(output.mirrorDir);
  }

  if (shouldLogResult) {
    logger.error(
      `[KakaoPageDump] 게임 실행 실패 진단 덤프가 생성되었습니다. 문의 시 함께 첨부해 주세요: ${archivePath}`,
    );
  }
  if (mirrorArchivePath) {
    logger.log(`[KakaoPageDump] Dev mirror dump archive: ${mirrorArchivePath}`);
  }

  return {
    archivePath,
    mirrorArchivePath,
  };
}

export function scheduleAutomationDumpRetentionCleanup() {
  if (cleanupTimer) return;

  void cleanupAutomationDumpArchives();
  cleanupTimer = setInterval(() => {
    void cleanupAutomationDumpArchives();
  }, DUMP_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export async function cleanupAutomationDumpArchives(now = Date.now()) {
  const output = getAutomationDumpOutput();
  await removeExpiredArchives(output.archiveDir, now);
  if (output.mirrorArchiveDir) {
    await removeExpiredArchives(output.mirrorArchiveDir, now);
  }
}

export function isAutomationDumpArchiveExpired(
  mtimeMs: number,
  now = Date.now(),
) {
  return now - mtimeMs > DUMP_RETENTION_MS;
}

export async function dumpAutomationPage(
  win: BrowserWindow,
  options: AutomationPageDumpOptions,
) {
  if (!isAutomationPageDumpEnabled()) return;
  if (win.isDestroyed()) return;
  if (options.mainWindow && win.id === options.mainWindow.id) return;
  if (options.debugWindow && win.id === options.debugWindow.id) return;
  if (win.webContents.isDestroyed()) return;

  const url = win.webContents.getURL();
  if (!url || url === "about:blank") return;

  const key = `${win.id}:${options.reason}:${url}`;
  const now = Date.now();
  const lastDumpAt = lastDumpAtByKey.get(key) ?? 0;
  if (now - lastDumpAt < MIN_DUMP_INTERVAL_MS) return;
  lastDumpAtByKey.set(key, now);

  const session = ensureDumpSession(options);
  const output = getAutomationDumpOutput(session);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const label = buildPageLabel(url);
  const stem = `${stamp}_win-${win.id}_${sanitizeDumpName(options.reason)}_${label}`;
  const basePaths = [path.join(output.primaryDir, stem)];
  if (output.mirrorDir) {
    basePaths.push(path.join(output.mirrorDir, stem));
  }

  try {
    await Promise.all(
      basePaths.map((basePath) =>
        fs.mkdir(path.dirname(basePath), { recursive: true }),
      ),
    );

    const page = await getPageSnapshot(win);
    const metadata = {
      dumpedAt: new Date(now).toISOString(),
      sessionId: session.id,
      reason: options.reason,
      triggerContext: options.triggerContext ?? null,
      windowId: win.id,
      windowTitle: win.getTitle(),
      windowVisible: win.isVisible(),
      windowFocused: win.isFocused(),
      url,
      bounds: win.getBounds(),
      page: {
        title: page?.title ?? null,
        url: page?.url ?? null,
        readyState: page?.readyState ?? null,
        bodyTextLength: page?.bodyText.length ?? null,
        htmlLength: page?.html.length ?? null,
      },
    };

    await writeDumpFile(
      basePaths,
      ".json",
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );

    if (page) {
      await writeDumpFile(basePaths, ".html", page.html, "utf-8");
      await writeDumpFile(basePaths, ".txt", page.bodyText, "utf-8");
    }

    try {
      const image = await win.webContents.capturePage();
      await writeDumpFile(basePaths, ".png", image.toPNG());
    } catch (error) {
      logger.warn(`[KakaoPageDump] Screenshot failed: ${String(error)}`);
    }

    session.dumpCount += 1;
    logger.log(`[KakaoPageDump] Dumped ${options.reason}: ${basePaths[0]}`);
  } catch (error) {
    logger.error("[KakaoPageDump] Failed to dump automation page:", error);
  }
}

function ensureDumpSession(options: AutomationPageDumpOptions) {
  if (activeSession) return activeSession;

  const startedAt = Date.now();
  activeSession = {
    id: `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}_loose`,
    startedAt,
    gameId: "POE2",
    serviceId: "Kakao Games",
    triggerContext: options.triggerContext,
    dumpCount: 0,
  };

  return activeSession;
}

function getAutomationDumpOutput(
  session?: AutomationDumpSession,
): AutomationDumpOutput {
  const userDataRoot = path.join(
    app.getPath("userData"),
    "Diagnostics",
    "kakao-page-dumps",
  );
  const sessionDirName = session?.id ?? "retention";
  const output: AutomationDumpOutput = {
    primaryDir: path.join(userDataRoot, "active", sessionDirName),
    archiveDir: path.join(userDataRoot, "failed"),
  };

  if (!app.isPackaged) {
    const devRoot = path.join(process.cwd(), ".tmp", "kakao-page-dumps");
    output.mirrorDir = path.join(devRoot, "active", sessionDirName);
    output.mirrorArchiveDir = path.join(devRoot, "failed");
  }

  return output;
}

async function writeDumpFile(
  basePaths: string[],
  extension: string,
  data: string | Buffer,
  encoding?: BufferEncoding,
) {
  await Promise.all(
    basePaths.map((basePath) =>
      typeof data === "string"
        ? fs.writeFile(`${basePath}${extension}`, data, encoding)
        : fs.writeFile(`${basePath}${extension}`, data),
    ),
  );
}

async function createDumpArchive(
  sourceDir: string,
  archiveDir: string,
  session: AutomationDumpSession,
  reason: string,
) {
  await fs.mkdir(archiveDir, { recursive: true });

  const zip = new JSZip();
  await addDirectoryToZip(zip, sourceDir, "");

  const archiveName = `${session.id}_${sanitizeDumpName(reason)}.zip`;
  const archivePath = path.join(archiveDir, archiveName);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  await fs.writeFile(archivePath, buffer);
  return archivePath;
}

async function addDirectoryToZip(
  zip: JSZip,
  dir: string,
  relativeRoot: string,
) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path
      .join(relativeRoot, entry.name)
      .replace(/\\/g, "/");

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, absolutePath, relativePath);
      continue;
    }

    if (entry.isFile()) {
      zip.file(relativePath, await fs.readFile(absolutePath));
    }
  }
}

async function removeExpiredArchives(dir: string, now: number) {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".zip")) return;

      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      if (!isAutomationDumpArchiveExpired(stat.mtimeMs, now)) return;

      await fs.rm(filePath, { force: true });
      logger.log(`[KakaoPageDump] Removed expired dump archive: ${filePath}`);
    }),
  );
}

async function hasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() || entry.isDirectory());
  } catch {
    return false;
  }
}

async function removeDirectory(dir: string) {
  try {
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: DIRECTORY_REMOVE_MAX_RETRIES,
      retryDelay: DIRECTORY_REMOVE_RETRY_DELAY_MS,
    });
  } catch (error) {
    if (isRetriableDirectoryRemoveError(error)) {
      logger.warn(
        `[KakaoPageDump] Diagnostic dump directory cleanup was skipped after retries: ${dir} (${String(error)})`,
      );
      return;
    }

    throw error;
  }
}

function isRetriableDirectoryRemoveError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    RETRIABLE_DIRECTORY_REMOVE_ERRORS.has(error.code)
  );
}

function buildPageLabel(url: string) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "") || "root";
    return sanitizeDumpName(`${parsed.hostname}_${pathname}`);
  } catch {
    return sanitizeDumpName(url);
  }
}

function sanitizeDumpName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

async function getPageSnapshot(
  win: BrowserWindow,
): Promise<PageSnapshot | null> {
  try {
    return await win.webContents.executeJavaScript(
      `(() => ({
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        bodyText: document.body?.innerText ?? "",
        html: document.documentElement?.outerHTML ?? ""
      }))()`,
      true,
    );
  } catch (error) {
    logger.warn(`[KakaoPageDump] DOM snapshot failed: ${String(error)}`);
    return null;
  }
}
