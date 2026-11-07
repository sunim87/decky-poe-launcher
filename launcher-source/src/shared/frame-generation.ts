import type { AppConfig } from "./types";

export type FrameGenerationMode = "off" | "lsfg" | "mako";

export function getFrameGenerationMode(
  config: Pick<AppConfig, "frameGenerationMode" | "lsfgEnabled">,
): FrameGenerationMode {
  if (config.frameGenerationMode) return config.frameGenerationMode;
  return config.lsfgEnabled === true ? "lsfg" : "off";
}

export function toggleFrameGenerationMode(
  current: FrameGenerationMode,
  selected: Exclude<FrameGenerationMode, "off">,
): FrameGenerationMode {
  return current === selected ? "off" : selected;
}
