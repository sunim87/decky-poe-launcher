import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSteamDeckScanCache,
  scanSteamDeckGameInstallPath,
} from "../utils/steamdeck-scan";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  readdir: vi.fn(async () => []),
}));
vi.mock("node:fs/promises", () => mocks);
vi.mock("../utils/wine", () => ({ isWineEnvironment: () => true }));
vi.mock("../utils/logger", () => ({ logger: { log: vi.fn() } }));

const installed = new Set<string>();
beforeEach(() => {
  clearSteamDeckScanCache();
  installed.clear();
  mocks.access.mockImplementation(async (file: string) => {
    if (!installed.has(file)) throw new Error("ENOENT");
  });
});

describe("Steam Deck installation discovery", () => {
  it("finds a game installed after a previous miss without restarting", async () => {
    expect(
      await scanSteamDeckGameInstallPath("Kakao Games", "POE2"),
    ).toBeNull();
    installed.add("C:\\Kakaogames\\Path of Exile2\\PathOfExile_KG.exe");
    expect(await scanSteamDeckGameInstallPath("Kakao Games", "POE2")).toBe(
      "C:\\Kakaogames\\Path of Exile2",
    );
  });

  it("rediscovers an installation when the cached folder has disappeared", async () => {
    installed.add("C:\\Kakaogames\\Path of Exile2\\PathOfExile_KG.exe");
    await scanSteamDeckGameInstallPath("Kakao Games", "POE2");
    installed.clear();
    installed.add("C:\\Daum Games\\Path of Exile2\\PathOfExile_x64_KG.exe");
    expect(await scanSteamDeckGameInstallPath("Kakao Games", "POE2")).toBe(
      "C:\\Daum Games\\Path of Exile2",
    );
  });
});
