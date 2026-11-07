import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app } from "electron";

import { isWineEnvironment } from "../utils/wine";

const DIRECTORY = "POE-FSR-Lite";
const MANIFEST = ".poe-fsr-lite.json";
const ROOT_FILES = ["dxgi.dll", "OptiScaler.ini"] as const;
let busy = false;
let settingChangePending = false;

export const isFsrLiteChangePending = () => settingChangePending || busy;

export async function withFsrLiteSettingChange(operation: () => Promise<void>) {
  if (isFsrLiteChangePending())
    throw new Error("FSR 설정 변경이 진행 중입니다.");
  settingChangePending = true;
  try {
    await operation();
  } finally {
    settingChangePending = false;
  }
}

export function updateIni(
  text: string,
  section: string,
  key: string,
  value: string,
) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start < 0) return `${text.trimEnd()}\n\n[${section}]\n${key}=${value}\n`;
  let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const found = lines.findIndex(
    (line, i) => i > start && i < end && line.split("=")[0].trim() === key,
  );
  if (found >= 0) lines[found] = `${key}=${value}`;
  else lines.splice(end, 0, `${key}=${value}`);
  return lines.join("\n");
}

export function fsrLiteSettings(source: string) {
  const changes: Record<string, Record<string, string>> = {
    Upscalers: { Dx12Upscaler: "fsr31" },
    FrameGen: { Enabled: "false" },
    FSR: {
      Fsr4Update: "false",
      Fsr4ForceEnableInt8: "false",
      UpscalerIndex: "0",
      Fsr4EnableWatermark: "auto",
    },
    Libraries: {
      FfxDx12Path: `.\\${DIRECTORY}\\amd_fidelityfx_loader_dx12.dll`,
      FfxDx12SRPath: `.\\${DIRECTORY}\\amd_fidelityfx_upscaler_dx12.dll`,
      FfxDx12FGPath: `.\\${DIRECTORY}\\amd_fidelityfx_framegeneration_dx12.dll`,
      XeSSPath: `.\\${DIRECTORY}\\libxess.dll`,
    },
    NvApi: { OverrideNvapiDll: "false" },
    Framerate: { FramerateLimit: "0" },
    Log: { LogToFile: "true", LogLevel: "1" },
  };
  for (const [section, entries] of Object.entries(changes)) {
    for (const [key, value] of Object.entries(entries))
      source = updateIni(source, section, key, value);
  }
  return source;
}

export function fsrLiteOverrides(
  inherited: string | undefined,
  enabled: boolean,
) {
  const parts = (inherited ?? "")
    .split(";")
    .filter((part) => part && !/^\s*dxgi\s*=/i.test(part));
  return enabled ? [...parts, "dxgi=n,b"].join(";") : parts.join(";");
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function saveInstallation(file: string, state: Installation) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(state), "utf8");
  await fs.rename(`${file}.tmp`, file);
}

export async function assertPoe2Stopped() {
  if (!isWineEnvironment())
    throw new Error("FSR Lite는 스팀덱에서만 지원합니다.");
  for (const name of await fs.readdir("Z:\\proc")) {
    if (!/^\d+$/.test(name)) continue;
    let command: Buffer;
    try {
      command = await fs.readFile(`Z:\\proc\\${name}\\cmdline`);
    } catch {
      continue;
    }
    const executable = command
      .subarray(0, command.indexOf(0) < 0 ? undefined : command.indexOf(0))
      .toString();
    if (/(?:PathOfExile(?:_x64)?_KG|POE2_Launcher)\.exe$/i.test(executable))
      throw new Error("POE2를 종료한 뒤 FSR 설정을 변경해 주세요.");
  }
}

interface Installation {
  originalFiles: Record<string, string | null>;
  upscale: string;
  reflex: string;
  owned?: Record<string, string>;
  phase?: "installing" | "enabled" | "disabling";
}

export async function applyFsrLite(game: string, enabled: boolean) {
  if (busy) throw new Error("FSR 설정 변경이 진행 중입니다.");
  busy = true;
  try {
    await assertPoe2Stopped();
    const manifest = path.join(game, MANIFEST);
    if (!enabled && !(await exists(manifest))) return;
    const target = path.join(game, DIRECTORY);
    const gameIni = path.join(
      app.getPath("documents"),
      "My Games",
      "Path of Exile 2",
      "poe2_production_Config.ini",
    );
    let settings = await fs.readFile(gameIni, "utf8");
    const previousSettings = settings;
    const previousManifest = (await exists(manifest))
      ? await fs.readFile(manifest, "utf8")
      : null;
    let state: Installation | undefined = previousManifest
      ? JSON.parse(previousManifest)
      : undefined;
    if (!enabled && !state) return;
    const snapshot: Record<string, Buffer | null> = {};
    for (const name of ROOT_FILES)
      snapshot[name] = (await exists(path.join(game, name)))
        ? await fs.readFile(path.join(game, name))
        : null;
    if (state?.owned) {
      for (const name of ["dxgi.dll"] as const) {
        const original = state.originalFiles[name];
        const isRestored =
          original === null
            ? snapshot[name] === null
            : snapshot[name]?.toString("base64") === original;
        if (state.phase === "disabling" && isRestored) continue;
        if (
          !snapshot[name] ||
          createHash("sha256").update(snapshot[name]!).digest("hex") !==
            state.owned[name]
        ) {
          throw new Error(
            `다른 프로그램이 ${name} 파일을 변경했습니다. FSR 파일을 확인해 주세요.`,
          );
        }
      }
    }
    try {
      if (enabled) {
        const source = app.isPackaged
          ? path.join(process.resourcesPath, "assets", "fsr-lite")
          : path.join(process.cwd(), "src/main/assets/fsr-lite");
        const hashes: Record<string, string> = JSON.parse(
          await fs.readFile(path.join(source, "hashes.json"), "utf8"),
        );
        for (const [name, hash] of Object.entries(hashes)) {
          if (
            createHash("sha256")
              .update(await fs.readFile(path.join(source, name)))
              .digest("hex") !== hash
          )
            throw new Error(`FSR 설치 파일 검증 실패: ${name}`);
        }
        if (!state) {
          if (await exists(path.join(game, ".decky-optiscaler.json")))
            throw new Error("기존 Decky OptiScaler 설치를 먼저 제거해 주세요.");
          state = {
            originalFiles: {},
            phase: "installing",
            upscale: settings.match(/^upscale=(.*)$/m)?.[1]?.trim() ?? "FSR",
            reflex: settings.match(/^reflex_mode=(.*)$/m)?.[1]?.trim() ?? "Off",
          };
          for (const name of ROOT_FILES)
            state.originalFiles[name] = (await exists(path.join(game, name)))
              ? (await fs.readFile(path.join(game, name))).toString("base64")
              : null;
          // Record originals before the first write so a failed install can be disabled safely.
          await saveInstallation(manifest, state);
        }
        await fs.cp(source, target, { recursive: true });
        await fs.copyFile(
          path.join(target, "OptiScaler.dll"),
          path.join(game, "dxgi.dll"),
        );
        await fs.writeFile(
          path.join(game, "OptiScaler.ini"),
          fsrLiteSettings(
            await fs.readFile(path.join(target, "OptiScaler.ini"), "utf8"),
          ),
          "utf8",
        );
        settings = settings.replace(/^upscale=.*$/m, "upscale=DLSS");
        settings = /^reflex_mode=/m.test(settings)
          ? settings.replace(/^reflex_mode=.*$/m, "reflex_mode=Off")
          : updateIni(settings, "DISPLAY", "reflex_mode", "Off");
        state.owned = {};
        state.phase = "enabled";
        for (const name of ROOT_FILES)
          state.owned[name] = createHash("sha256")
            .update(await fs.readFile(path.join(game, name)))
            .digest("hex");
        await saveInstallation(manifest, state);
      } else if (state) {
        state.phase = "disabling";
        await saveInstallation(manifest, state);
        for (const name of ROOT_FILES) {
          const original = state.originalFiles[name];
          if (original === null)
            await fs.rm(path.join(game, name), { force: true });
          else
            await fs.writeFile(
              path.join(game, name),
              Buffer.from(original, "base64"),
            );
        }
        settings = settings.replace(
          /^upscale=.*$/m,
          `upscale=${state.upscale}`,
        );
        settings = settings.replace(
          /^reflex_mode=.*$/m,
          `reflex_mode=${state.reflex}`,
        );
      }
      await fs.writeFile(gameIni, settings, "utf8");
      if (!enabled) await fs.rm(manifest);
    } catch (error) {
      for (const name of ROOT_FILES) {
        if (snapshot[name])
          await fs.writeFile(path.join(game, name), snapshot[name]!);
        else await fs.rm(path.join(game, name), { force: true });
      }
      await fs.writeFile(gameIni, previousSettings, "utf8");
      if (previousManifest)
        await fs.writeFile(manifest, previousManifest, "utf8");
      else await fs.rm(manifest, { force: true });
      throw error;
    }
  } finally {
    busy = false;
  }
}
