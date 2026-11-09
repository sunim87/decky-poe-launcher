import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";

import axios from "axios";
import { app } from "electron";

import { assertPoe2Stopped } from "../game/fsr-lite";

import type { UpdateStatus } from "../../shared/types";

const FEED =
  "https://github.com/sunim87/decky-poe-launcher/releases/latest/download/launcher-update.json";
const PREFIX =
  "https://github.com/sunim87/decky-poe-launcher/releases/download/";
interface Manifest {
  schema: number;
  build: number;
  version: string;
  url: string;
  size: number;
  sha256: string;
}
type Status = (value: UpdateStatus) => void;
let pendingDownload: Promise<void> | null = null;

export function validateLauncherUpdate(value: unknown): Manifest {
  if (!value || typeof value !== "object")
    throw new Error("런처 업데이트 정보가 올바르지 않습니다.");
  const data = value as Manifest;
  if (
    data.schema !== 1 ||
    !Number.isSafeInteger(data.build) ||
    data.build < 1 ||
    typeof data.version !== "string" ||
    typeof data.url !== "string" ||
    !data.url.startsWith(PREFIX) ||
    !data.url.endsWith(".zip") ||
    !Number.isSafeInteger(data.size) ||
    data.size <= 0 ||
    data.size > 1536 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(data.sha256)
  ) {
    throw new Error("런처 업데이트 정보 검증에 실패했습니다.");
  }
  return data;
}

function location() {
  const linux = process.env.POE_LAUNCHER_BASE;
  if (!linux?.startsWith("/") || linux.includes("\n"))
    throw new Error(
      "Decky 플러그인의 런처 설치/복구로 업데이트 지원을 먼저 설치해 주세요.",
    );
  return { linux, wine: `Z:${linux.replace(/\//g, "\\")}` };
}

export function migratePortableGamepadWrapper() {
  const linux = process.env.POE_LAUNCHER_BASE;
  if (!linux?.startsWith("/") || linux.includes("\n") || process.env.POE_GAMEPAD_STATE) return;
  const child = spawn(
    "C:\\windows\\system32\\start.exe",
    [
      "/wait", "/unix", "/usr/bin/python3",
      `${linux}/launcher/resources/launcher_updater.py`,
      "--base", linux, "--migrate-wrapper",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  child.on("error", () => {});
}

export async function checkPortableLauncherUpdate(notify: Status) {
  if (pendingDownload) return pendingDownload;
  notify({ state: "checking" });
  const { wine } = location();
  const current = JSON.parse(
    await fs.readFile(`${wine}\\launcher\\.launcher-build.json`, "utf8"),
  ) as { build: number };
  const response = await axios.get(FEED, {
    timeout: 15000,
    maxContentLength: 65536,
  });
  const manifest = validateLauncherUpdate(response.data);
  if (manifest.build <= current.build) {
    notify({ state: "idle" });
    return;
  }
  notify({ state: "available", version: manifest.version, changelogs: [] });
  await downloadPortableLauncherUpdate(notify);
}

export function downloadPortableLauncherUpdate(notify: Status): Promise<void> {
  if (pendingDownload) return pendingDownload;
  pendingDownload = downloadImpl(notify).finally(() => {
    pendingDownload = null;
  });
  return pendingDownload;
}

async function downloadImpl(notify: Status) {
  const { linux, wine } = location();
  const requestId = randomUUID();
  const statusFile = `${wine}\\launcher-update-status.json`;
  let spawnError: Error | undefined;
  const child = spawn(
    "C:\\windows\\system32\\start.exe",
    [
      "/wait",
      "/unix",
      "/usr/bin/python3",
      `${linux}/launcher_updater.py`,
      "--base",
      linux,
      "--download-only",
      "--request-id",
      requestId,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  child.once("error", (error) => {
    spawnError = error;
  });
  notify({ state: "downloading", progress: 0 });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    let state:
      | {
          requestId?: string;
          state?: string;
          progress?: number;
          version?: string;
          message?: string;
        }
      | undefined;
    try {
      state = JSON.parse(await fs.readFile(statusFile, "utf8"));
    } catch {
      /* Helper is starting or atomically replacing the status. */
    }
    if (state?.requestId === requestId) {
      if (state.state === "error")
        throw new Error(
          state.message || "런처 업데이트 다운로드에 실패했습니다.",
        );
      if (state.state === "downloaded" && state.version) {
        notify({ state: "downloaded", version: state.version });
        return;
      }
      if (state.state === "idle") {
        notify({ state: "idle" });
        return;
      }
      if (state.state === "downloading")
        notify({
          state: "downloading",
          progress: state.progress || 0,
          version: state.version,
        });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "업데이트 다운로드 시간이 초과됐습니다. 다음 실행 때 다시 시도합니다.",
  );
}

export async function restartForPortableLauncherUpdate() {
  await assertPoe2Stopped();
  const { wine } = location();
  validateLauncherUpdate(
    JSON.parse(
      await fs.readFile(`${wine}\\launcher-update-pending.json`, "utf8"),
    ),
  );
  await fs.writeFile(
    `${wine}\\launcher-update-restart.flag`,
    "restart",
    "utf8",
  );
  app.quit();
}
