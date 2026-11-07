import * as fs from "node:fs/promises";
import * as path from "node:path";

import { app } from "electron";

import { fsrLiteOverrides } from "./fsr-lite";
import { getFrameGenerationMode } from "../../shared/frame-generation";
import { findLinuxHomeZPath } from "../utils/lsfg-config";
import { isWineEnvironment } from "../utils/wine";

import type { AppConfig } from "../../shared/types";

const PROFILE_NAME = "POE Launcher Frame Generation";

export function createFrameGenerationEnvironment(
  inherited: NodeJS.ProcessEnv,
  config: AppConfig,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  env.WINEDLLOVERRIDES = fsrLiteOverrides(
    inherited.WINEDLLOVERRIDES,
    config.activeGame === "POE2" && config.fsrLiteEnabled === true,
  );
  for (const key of Object.keys(env)) {
    if (/^(LSFG|LSFGVK|MAKO|ENABLE_MAKO|DISABLE_MAKO)/i.test(key)) {
      delete env[key];
    }
  }
  env.DISABLE_LSFG = "1";
  env.DISABLE_LSFGVK = "1";
  env.DISABLE_LSFGVK_EXPERIMENTAL = "1";
  env.DISABLE_MAKO = "1";
  env.DISABLE_MAKO_SPATIAL_SCALING = "1";
  const mode = getFrameGenerationMode(config);
  if (mode === "lsfg") {
    delete env.DISABLE_LSFGVK;
    env.LSFGVK_PROFILE = PROFILE_NAME;
  }
  if (mode === "mako") {
    delete env.DISABLE_MAKO;
    env.ENABLE_MAKO = "1";
    env.MAKO_PROFILE = PROFILE_NAME;
    env.MAKO_DISABLE_HDR_EXPOSURE = "1";
    env.DXVK_HDR = "0";
    env.DISABLE_VK_LAYER_VALVE_steam_overlay_1 = "1";
  }
  return env;
}

export async function prepareFrameGeneration(
  config: AppConfig,
  executablePath: string,
): Promise<{
  env: NodeJS.ProcessEnv;
  helper?: string;
  workingDirectory?: string;
}> {
  if (!isWineEnvironment()) return { env: { ...process.env } };
  const env = createFrameGenerationEnvironment(process.env, config);
  const mode = getFrameGenerationMode(config);
  if (mode === "off") return prepareUnixHelper(env, executablePath);
  const home = findLinuxHomeZPath();
  if (!home)
    throw new Error("프레임 생성 설정을 위한 리눅스 홈을 찾지 못했습니다.");
  const sourceDirectory = mode === "lsfg" ? "lsfg-vk" : "mako-render";
  const source = `${home}\\.config\\${sourceDirectory}\\conf.toml`;
  const content = await fs.readFile(source, "utf8");
  if (!/^\s*version\s*=\s*2\s*$/m.test(content)) {
    throw new Error(`${sourceDirectory}의 version = 2 설정이 필요합니다.`);
  }
  const multiplier = Number(config.lsfgMultiplier) || 2;
  const profile = [
    "[[profile]]",
    `name = "${PROFILE_NAME}"`,
    `multiplier = ${multiplier}`,
    "performance_mode = true",
    "flow_scale = 0.65",
    ...(mode === "lsfg"
      ? ["preserve_swapchain_image_count = true"]
      : [
          "scaling_enabled = false",
          "frame_generation_provisioned = true",
          "frame_generation_enabled = true",
          "adaptive = false",
          'pacing = "none"',
        ]),
  ].join("\n");
  const directory = path.join(app.getPath("userData"), "frame-generation");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${mode}.toml`);
  await fs.writeFile(
    `${target}.tmp`,
    `${content.trimEnd()}\n\n${profile}\n`,
    "utf8",
  );
  await fs.rename(`${target}.tmp`, target);
  // Vulkan runs in the Linux host while Electron sees the same path through C:.
  const prefix = process.env.STEAM_COMPAT_DATA_PATH;
  if (!prefix || !/^[A-Za-z]:\\/.test(target)) {
    throw new Error("프레임 생성 설정의 Proton 경로를 확인하지 못했습니다.");
  }
  const linuxTarget = `${prefix.replace(/\/$/, "")}/pfx/drive_${target[0].toLowerCase()}/${target.slice(3).replace(/\\/g, "/")}`;
  env[mode === "lsfg" ? "LSFGVK_CONFIG" : "MAKO_CONFIG"] = linuxTarget;
  env.ENABLE_GAMESCOPE_WSI = "0";
  return prepareUnixHelper(env, executablePath);
}

async function prepareUnixHelper(
  env: NodeJS.ProcessEnv,
  executablePath: string,
) {
  if (!process.env.POE_PROTON_PATH) {
    throw new Error("실행 스크립트에 POE_PROTON_PATH가 필요합니다.");
  }
  const directory = path.join(app.getPath("userData"), "frame-generation");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, "launch.sh");
  const prefix = process.env.STEAM_COMPAT_DATA_PATH;
  if (!prefix || !/^[A-Za-z]:\\/.test(target)) {
    throw new Error("게임 실행 스크립트의 Proton 경로를 확인하지 못했습니다.");
  }
  const helper = `${prefix.replace(/\/$/, "")}/pfx/drive_${target[0].toLowerCase()}/${target.slice(3).replace(/\\/g, "/")}`;
  const gameDirectory = path.win32.dirname(executablePath);
  if (!/^[A-Za-z]:\\/.test(gameDirectory)) {
    throw new Error("게임 작업 폴더의 Linux 경로를 확인하지 못했습니다.");
  }
  const suffix = gameDirectory.slice(3).replace(/\\/g, "/");
  const workingDirectory =
    gameDirectory[0].toLowerCase() === "z"
      ? `/${suffix}`
      : `${prefix.replace(/\/$/, "")}/pfx/dosdevices/${gameDirectory[0].toLowerCase()}:/${suffix}`;
  const exports = Object.entries(env)
    .filter(([key]) =>
      /^(LSFG|DISABLE_LSFG|MAKO|ENABLE_MAKO|DISABLE_MAKO|WINEDLLOVERRIDES$|ENABLE_GAMESCOPE_WSI$|DXVK_HDR$|DISABLE_VK_LAYER_VALVE_steam_overlay_1$)/.test(
        key,
      ),
    )
    .map(
      ([key, value]) =>
        `export ${key}='${String(value).replace(/'/g, "'\\''")}'`,
    );
  const script = [
    "#!/bin/bash",
    "set -e",
    'cd -- "$1"',
    "shift",
    "while IFS='=' read -r key value; do",
    '  case "$key" in LSFG*|DISABLE_LSFG*|MAKO*|ENABLE_MAKO*|DISABLE_MAKO*) unset "$key";; esac',
    "done < <(env)",
    ...exports,
    'exec "${POE_PROTON_PATH:?}" run "$@"',
    "",
  ].join("\n");
  await fs.writeFile(`${target}.tmp`, script, "utf8");
  await fs.rename(`${target}.tmp`, target);
  return { env, helper, workingDirectory };
}
