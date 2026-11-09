import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../../shared/config";
import {
  makoTargetFps,
  prepareFrameGeneration,
} from "../game/frame-generation";

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  readFile: vi.fn(async (file: unknown): Promise<string> => {
    if (String(file).endsWith("sys_vendor")) return "Valve\n";
    if (String(file).endsWith("product_name")) return "Galileo\n";
    return "version = 2\n[global]\nallow_fp16 = true\n";
  }),
}));
vi.mock("node:fs/promises", () => ({ ...mocks, default: mocks }));
vi.mock("electron", () => ({
  app: {
    getPath: () =>
      "C:\\users\\steamuser\\AppData\\Roaming\\POE2 Unofficial Launcher",
  },
}));
vi.mock("../utils/wine", () => ({ isWineEnvironment: () => true }));
vi.mock("../utils/lsfg-config", () => ({
  findLinuxHomeZPath: () => "Z:\\home\\deck",
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("POE_PROTON_PATH", "/steam/Proton 10.0/proton");
  vi.stubEnv(
    "STEAM_COMPAT_DATA_PATH",
    "/home/deck/Applications/POE2-Launcher/compatdata",
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("game launch working directory", () => {
  it("uses the Steam-selected Proton when the launcher wrapper variable is missing", async () => {
    vi.stubEnv("POE_PROTON_PATH", undefined);
    vi.stubEnv("STEAM_COMPAT_TOOL_PATHS", "/steam/sniper:/steam/Proton 10.0");
    mocks.stat
      .mockRejectedValueOnce(new Error("Missing proton"))
      .mockResolvedValueOnce({ isFile: () => true });
    await prepareFrameGeneration(
      { ...DEFAULT_CONFIG, frameGenerationMode: "off" },
      "C:\\Game\\PathOfExile_KG.exe",
    );
    expect(mocks.writeFile).toHaveBeenLastCalledWith(
      expect.stringContaining("launch.sh.tmp"),
      expect.stringContaining(
        "export POE_PROTON_PATH='/steam/Proton 10.0/proton'",
      ),
      "utf8",
    );
  });
  it.each([true, false])(
    "isolates native Vulkan MAKO swapchain compatibility when FSR is %s",
    async (fsrLiteEnabled) => {
      mocks.readFile.mockImplementation(async (file: unknown) => {
        if (String(file).endsWith("sys_vendor")) return "LENOVO";
        if (String(file).endsWith("product_name")) return "83N0";
        return "version = 2\n[global]\nallow_fp16 = true\n";
      });
      await prepareFrameGeneration(
        { ...DEFAULT_CONFIG, frameGenerationMode: "mako", fsrLiteEnabled },
        "C:\\Game\\PathOfExile_KG.exe",
      );
      const call = mocks.writeFile.mock.calls.find(([target]) =>
        String(target).endsWith("mako.toml.tmp"),
      );
      expect(
        String(call?.[1]).includes(
          "swapchain_image_count_compatibility = true",
        ),
      ).toBe(!fsrLiteEnabled);
    },
  );
  it.each([
    ["Valve", "Jupiter", 90],
    ["Valve\n", "Galileo\n", 90],
    ["LENOVO", "83N0", 144],
    ["ASUSTeK COMPUTER INC.", "ROG Ally", 144],
    ["", "", 144],
  ])("selects MAKO target for %s/%s", (vendor, product, fps) => {
    expect(makoTargetFps(vendor, product)).toBe(fps);
  });

  it.each([90, 144])(
    "writes the device's %i FPS into the isolated MAKO profile",
    async (fps) => {
      mocks.readFile.mockImplementation(async (file: unknown) => {
        if (String(file).endsWith("sys_vendor"))
          return fps === 90 ? "Valve" : "LENOVO";
        if (String(file).endsWith("product_name"))
          return fps === 90 ? "Galileo" : "83N0";
        return 'version = 2\n[global]\nallow_fp16 = true\n[[profile]]\nname = "mako"\ntarget_fps = 90\n';
      });
      await prepareFrameGeneration(
        { ...DEFAULT_CONFIG, frameGenerationMode: "mako" },
        "C:\\Kakaogames\\Path of Exile2\\PathOfExile_KG.exe",
      );
      const call = mocks.writeFile.mock.calls.find(([target]) =>
        String(target).endsWith("mako.toml.tmp"),
      );
      expect(call?.[1]).toContain(
        `name = "POE Launcher Frame Generation"\nmultiplier = 2`,
      );
      expect(
        String(call?.[1]).split('name = "POE Launcher Frame Generation"')[1],
      ).toContain(`target_fps = ${fps}`);
      const managed = String(call?.[1]).split(
        'name = "POE Launcher Frame Generation"',
      )[1];
      if (fps === 144) expect(managed).toContain("base_fps_cap = 72");
      else expect(managed).not.toContain("base_fps_cap");
    },
  );
  it.each([
    ["2", 72],
    ["3", 48],
    ["4", 36],
  ] as const)(
    "caps non-Deck native FPS for %sx generation",
    async (multiplier, cap) => {
      mocks.readFile.mockImplementation(async (file: unknown) => {
        if (String(file).endsWith("sys_vendor")) return "LENOVO";
        if (String(file).endsWith("product_name")) return "83N0";
        return "version = 2\n[global]\nallow_fp16 = true\n";
      });
      await prepareFrameGeneration(
        {
          ...DEFAULT_CONFIG,
          frameGenerationMode: "mako",
          lsfgMultiplier: multiplier,
        },
        "C:\\Game\\PathOfExile_KG.exe",
      );
      const call = mocks.writeFile.mock.calls.find(([target]) =>
        String(target).endsWith("mako.toml.tmp"),
      );
      expect(call?.[1]).toContain(`base_fps_cap = ${cap}`);
    },
  );
  it.each([
    [
      "C:\\Kakaogames\\Path of Exile2\\PathOfExile_KG.exe",
      "/home/deck/Applications/POE2-Launcher/compatdata/pfx/dosdevices/c:/Kakaogames/Path of Exile2",
    ],
    [
      "Z:\\home\\deck\\Games\\Path of Exile2\\PathOfExile_KG.exe",
      "/home/deck/Games/Path of Exile2",
    ],
  ])(
    "keeps installed game files discoverable for %s",
    async (executable, directory) => {
      const result = await prepareFrameGeneration(
        { ...DEFAULT_CONFIG, frameGenerationMode: "mako" },
        executable,
      );
      expect(result.workingDirectory).toBe(directory);
      expect(result.env.ENABLE_MAKO).toBe("1");
      expect(result.env.DISABLE_LSFGVK).toBe("1");
      expect(result.helper).toContain(
        "/POE2 Unofficial Launcher/frame-generation/launch.sh",
      );
      expect(mocks.writeFile).toHaveBeenLastCalledWith(
        expect.stringContaining("launch.sh.tmp"),
        expect.stringContaining('cd -- "$1"\nshift\n'),
        "utf8",
      );
      expect(mocks.rename).toHaveBeenCalledTimes(2);
      expect(
        mocks.writeFile.mock.calls.every(([target]) =>
          String(target).includes("POE2 Unofficial Launcher"),
        ),
      ).toBe(true);
    },
  );
});
