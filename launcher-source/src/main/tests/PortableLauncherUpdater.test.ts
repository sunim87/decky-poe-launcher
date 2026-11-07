import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  checkPortableLauncherUpdate,
  restartForPortableLauncherUpdate,
  validateLauncherUpdate,
} from "../services/PortableLauncherUpdater";

const manifest = {
  schema: 1,
  build: 2,
  version: "1.4.2-sd.20",
  url: "https://github.com/sunim87/decky-poe-launcher/releases/download/v0.1.1/runtime.zip",
  size: 100,
  sha256: "a".repeat(64),
};
const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  get: vi.fn(),
  spawn: vi.fn(),
  quit: vi.fn(),
  guard: vi.fn(),
  requestId: "",
}));
vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile, writeFile: mocks.writeFile },
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));
vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  default: { spawn: mocks.spawn },
}));
vi.mock("axios", () => ({ default: { get: mocks.get } }));
vi.mock("electron", () => ({ app: { quit: mocks.quit } }));
vi.mock("../game/fsr-lite", () => ({ assertPoe2Stopped: mocks.guard }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("POE_LAUNCHER_BASE", "/home/deck/Applications/POE2-Launcher");
  mocks.guard.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({ data: manifest });
  mocks.spawn.mockImplementation((_command, args) => {
    mocks.requestId = args[args.indexOf("--request-id") + 1];
    return { once: vi.fn() };
  });
  mocks.readFile.mockImplementation(async (file: string) =>
    JSON.stringify(
      file.endsWith(".launcher-build.json")
        ? { build: 1 }
        : file.endsWith("pending.json")
          ? manifest
          : {
              requestId: mocks.requestId,
              state: "downloaded",
              version: manifest.version,
            },
    ),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("launcher-only update integration", () => {
  it("automatically downloads a newer launcher through the Linux helper", async () => {
    const notify = vi.fn();
    await checkPortableLauncherUpdate(notify);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringContaining("start.exe"),
      expect.arrayContaining(["/usr/bin/python3", "--download-only"]),
      expect.anything(),
    );
    expect(notify).toHaveBeenLastCalledWith({
      state: "downloaded",
      version: manifest.version,
    });
  });
  it("does not download an equal or older build", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ build: 2 }));
    const notify = vi.fn();
    await checkPortableLauncherUpdate(notify);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith({ state: "idle" });
  });
  it("refuses foreign update URLs", () => {
    expect(() =>
      validateLauncherUpdate({
        ...manifest,
        url: "https://example.com/runtime.zip",
      }),
    ).toThrow();
  });
  it("does not quit or request restart while a game is running", async () => {
    mocks.guard.mockRejectedValueOnce(Error("Close game"));
    await expect(restartForPortableLauncherUpdate()).rejects.toThrow(
      "Close game",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
  });
  it("requests wrapper restart only after validating a pending update", async () => {
    await restartForPortableLauncherUpdate();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("launcher-update-restart.flag"),
      "restart",
      "utf8",
    );
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
